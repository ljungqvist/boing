package com.margelo.nitro.boingpose

import com.margelo.nitro.core.Promise
import kotlin.math.roundToLong

class HybridBoingPose : HybridBoingPoseSpec() {
  init {
    CrashReports.install()
  }

  override fun lastCrash(): String = CrashReports.last()

  override fun clearCrash() = CrashReports.clear()

  override fun createDetector(modelPath: String, preferGpu: Boolean): HybridPoseDetectorSpec =
    HybridPoseDetector(modelPath, preferGpu)

  override fun videoInfo(path: String): VideoInfo = readVideoInfo(path.removePrefix("file://"))

  override fun analyzeVideo(
    path: String,
    options: AnalyzeOptions,
    onProgress: (fraction: Double) -> Unit,
  ): Promise<AnalyzeResult> = Promise.async {
    val file = path.removePrefix("file://")
    val info = readVideoInfo(file)
    val landmarker = VideoLandmarker.create(options.modelPath, options.preferGpu)
    try {
      val from = maxOf(0.0, options.from)
      val to = minOf(options.to, info.duration + 1.0)
      val fromUs = (from * 1e6).roundToLong()
      val toUs = (to * 1e6).roundToLong()
      val minUs = (options.minInterval * 1e6).roundToLong()
      val times = ArrayList<Double>()
      val found = ArrayList<Double>()
      val landmarks = ArrayList<DoubleArray>()
      var width = info.width
      var height = info.height
      var lastUs = Long.MIN_VALUE
      var reported = -1.0
      decodeFrames(file, fromUs, toUs, info.rotation.toInt(),
        want = { pts -> lastUs == Long.MIN_VALUE || pts - lastUs >= minUs - 500 },
        onFrame = { pts, bitmap ->
          lastUs = pts
          width = bitmap.width.toDouble()
          height = bitmap.height.toDouble()
          val t = pts / 1e6
          val lm = landmarker.detect(bitmap, t)
          times.add(t)
          found.add(if (lm != null) 1.0 else 0.0)
          landmarks.add(lm ?: DoubleArray(LANDMARKS * VALUES))
          val p = if (to > from) (t - from) / (to - from) else 1.0
          if (p - reported >= 0.01) {
            reported = p
            onProgress(p.coerceIn(0.0, 1.0))
          }
        })
      val flat = DoubleArray(landmarks.size * LANDMARKS * VALUES)
      landmarks.forEachIndexed { k, a -> a.copyInto(flat, k * LANDMARKS * VALUES) }
      AnalyzeResult(
        width = width,
        height = height,
        times = times.toDoubleArray(),
        found = found.toDoubleArray(),
        landmarks = flat,
        delegate = landmarker.delegate,
      )
    } finally {
      landmarker.close()
    }
  }
}
