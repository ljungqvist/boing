package com.margelo.nitro.boingpose

import android.util.Log
import com.margelo.nitro.core.Promise
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import kotlin.math.roundToLong

class HybridBoingPose : HybridBoingPoseSpec() {
  init {
    CrashReports.install()
  }

  override fun lastCrash(): String = CrashReports.last()

  override fun clearCrash() = CrashReports.clear()

  override fun createDetector(modelPath: String, preferGpu: Boolean): HybridPoseDetectorSpec =
    HybridPoseDetector(modelPath, preferGpu)

  override fun prepare(modelPath: String, preferGpu: Boolean, perFrame: Boolean) = Prepared.prepare(modelPath, preferGpu, perFrame)

  override fun releasePrepared() = Prepared.release()

  override fun videoInfo(path: String): VideoInfo = readVideoInfo(path.removePrefix("file://"))

  override fun analyzeVideo(
    path: String,
    options: AnalyzeOptions,
    onProgress: (fraction: Double) -> Unit,
  ): Promise<AnalyzeResult> = Promise.async {
    val start = System.nanoTime()
    val file = path.removePrefix("file://")
    val (rotation, duration) = readRotationAndDuration(file)
    val open0 = System.nanoTime()
    val prepared = Prepared.take(options.modelPath, options.preferGpu, options.perFrame)
    val landmarker = prepared ?: VideoLandmarker.create(options.modelPath, options.preferGpu, options.perFrame)
    // IMAGE mode: frames don't depend on each other, so CPU landmarkers can take frames alongside the first one.
    val helpersAsked = if (options.perFrame) SharedInference.helperLimit((options.cpuHelpers ?: 0.0).toInt()) else 0
    val openNs = System.nanoTime() - open0
    var poseNs = 0L
    var helpers = 0
    var helperFrames = 0
    try {
      val from = maxOf(0.0, options.from)
      val to = minOf(options.to, duration + 1.0)
      val fromUs = (from * 1e6).roundToLong()
      val toUs = (to * 1e6).roundToLong()
      val minUs = (options.minInterval * 1e6).roundToLong()
      val times = ArrayList<Double>()
      val found = ArrayList<Double>()
      val landmarks = ArrayList<DoubleArray>()
      var width = 0.0
      var height = 0.0
      var lastUs = Long.MIN_VALUE
      var reported = -1.0
      // Called on the decoding thread.
      val want = { pts: Long ->
        val ok = lastUs == Long.MIN_VALUE || pts - lastUs >= minUs - 500
        if (ok) lastUs = pts
        ok
      }
      val reader = FrameReader(file, fromUs, toUs, rotation, want, ahead = 3 + 2 * helpersAsked)
      val progress = { t: Double ->
        val p = if (to > from) (t - from) / (to - from) else 1.0
        if (p - reported >= 0.01) {
          reported = p
          onProgress(p.coerceIn(0.0, 1.0))
        }
      }
      val add = { t: Double, lm: DoubleArray? ->
        times.add(t)
        found.add(if (lm != null) 1.0 else 0.0)
        landmarks.add(lm ?: DoubleArray(LANDMARKS * VALUES))
      }
      try {
        if (helpersAsked == 0) {
          while (true) {
            val frame = reader.next() ?: break
            val bitmap = frame.bitmap
            width = bitmap.width.toDouble()
            height = bitmap.height.toDouble()
            val t = frame.ptsUs / 1e6
            val p0 = System.nanoTime()
            val lm = landmarker.detect(bitmap, t)
            poseNs += System.nanoTime() - p0
            add(t, lm)
            progress(t)
          }
        } else {
          // The first landmarker starts at once; the CPU helpers join as they load (≈ 0.3 s each on a slow tablet).
          // Results are collected in frame order.
          val shared = SharedInference(landmarker)
          Thread({
            repeat(helpersAsked) {
              val h = try {
                VideoLandmarker.create(options.modelPath, false, true)
              } catch (e: Throwable) {
                Log.w("BoingPose", "CPU helper failed to load", e)
                return@Thread
              }
              if (!shared.add(h)) {
                h.close()
                return@Thread
              }
            }
          }, "BoingPoseHelpers").start()
          val pending = ArrayList<Pair<Double, Future<DoubleArray?>>>()
          var prevUs = -1L
          var gapUs = 0.0
          val p0 = System.nanoTime()
          try {
            while (true) {
              val frame = reader.next() ?: break
              width = frame.bitmap.width.toDouble()
              height = frame.bitmap.height.toDouble()
              val t = frame.ptsUs / 1e6
              if (prevUs >= 0) gapUs = if (gapUs == 0.0) (frame.ptsUs - prevUs).toDouble() else 0.9 * gapUs + 0.1 * (frame.ptsUs - prevUs)
              prevUs = frame.ptsUs
              val left = if (gapUs > 0) (toUs - frame.ptsUs) / gapUs else Double.MAX_VALUE
              pending.add(t to shared.submit(frame.bitmap, t, left))
              progress(t)
            }
            for ((t, f) in pending) {
              add(t, try {
                f.get()
              } catch (e: ExecutionException) {
                throw e.cause ?: e
              })
            }
          } finally {
            shared.close()
          }
          poseNs = System.nanoTime() - p0
          helpers = shared.helpers
          helperFrames = shared.helperFrames
        }
      } finally {
        reader.close()
      }
      val flat = DoubleArray(landmarks.size * LANDMARKS * VALUES)
      landmarks.forEachIndexed { k, a -> a.copyInto(flat, k * LANDMARKS * VALUES) }
      AnalyzeResult(
        width = width,
        height = height,
        times = times.toDoubleArray(),
        found = found.toDoubleArray(),
        landmarks = flat,
        delegate = landmarker.delegate,
        timing = AnalyzeTiming(
          openMs = openNs / 1e6,
          decodeMs = reader.busyNs / 1e6,
          poseMs = poseNs / 1e6,
          totalMs = (System.nanoTime() - start) / 1e6,
          decoded = reader.decoded.toDouble(),
          helpers = helpers.toDouble(),
          helperFrames = helperFrames.toDouble(),
        ),
      )
    } finally {
      landmarker.close()
      // The next video gets a fresh one (no tracking state carried over), loaded while nothing is measured.
      if (prepared != null) Prepared.refill(options.modelPath, options.preferGpu, options.perFrame)
    }
  }
}

/**
 * One pose landmarker loaded ahead of time, on a thread of its own, for the next `analyzeVideo`
 * with the same model: loading the heavy model takes a while, on the GPU even longer.
 */
private object Prepared {
  private const val TAG = "BoingPose"
  private val loader = Executors.newSingleThreadExecutor { r -> Thread(r, "BoingPosePrepare") }
  private var key: Triple<String, Boolean, Boolean>? = null
  private var next: Future<VideoLandmarker>? = null

  @Synchronized
  fun prepare(modelPath: String, preferGpu: Boolean, perFrame: Boolean) {
    val k = Triple(modelPath, preferGpu, perFrame)
    if (key == k) {
      if (next == null) next = load(modelPath, preferGpu, perFrame)
      return
    }
    release()
    key = k
    next = load(modelPath, preferGpu, perFrame)
  }

  @Synchronized
  fun release() {
    key = null
    val f = next ?: return
    next = null
    // After it has loaded (the loader runs one task at a time).
    loader.execute { closeQuietly(f) }
  }

  /** The prepared landmarker for this model and mode (waits while it loads), or null when there's none or it failed to load. */
  fun take(modelPath: String, preferGpu: Boolean, perFrame: Boolean): VideoLandmarker? {
    val f = synchronized(this) {
      if (key != Triple(modelPath, preferGpu, perFrame)) return null
      next.also { next = null }
    } ?: return null
    return try {
      f.get()
    } catch (e: Throwable) {
      Log.w(TAG, "Prepared pose landmarker failed to load", e)
      null
    }
  }

  /** Loads the next one, if this model is still the prepared one. */
  @Synchronized
  fun refill(modelPath: String, preferGpu: Boolean, perFrame: Boolean) {
    if (key == Triple(modelPath, preferGpu, perFrame) && next == null) next = load(modelPath, preferGpu, perFrame)
  }

  private fun load(modelPath: String, preferGpu: Boolean, perFrame: Boolean): Future<VideoLandmarker> =
    loader.submit<VideoLandmarker> { VideoLandmarker.create(modelPath, preferGpu, perFrame) }

  private fun closeQuietly(f: Future<VideoLandmarker>) {
    try {
      f.get().close()
    } catch (_: Throwable) {
      // failed to load: nothing to free
    }
  }
}
