package com.margelo.nitro.boingpose

import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.margelo.nitro.NitroModules
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/**
 * IMAGE-mode landmarkers sharing the frames of one video: `fast` (the GPU one, or the CPU one when there's no GPU) and
 * CPU helpers that join as soon as they have loaded (`add`). Frames don't depend on each other in IMAGE mode, so each
 * goes to whichever landmarker is free. A helper only takes a frame while the fast one has more frames ahead of it than
 * that helper needs for one, so the last frames never wait on a slower helper: the whole is never slower than the fast
 * one alone, give or take a frame. Results are the same as from the fast one alone, up to the GPU/CPU float difference.
 * How many helpers a phone gets: `helpersFor`.
 *
 * On a Galaxy Tab A8 (2026-11-25, heavy model, 143 frames): GPU alone 239 ms per frame, + 1 CPU helper 162 ms, + 2 142 ms;
 * CPU alone 451 ms, + 1 CPU helper 260–295 ms. MediaPipe's CPU path alone doesn't fill the cores.
 */
class SharedInference(fast: VideoLandmarker) : AutoCloseable {
  private class Worker(val landmarker: VideoLandmarker) {
    var busy = false
    /** Mean nanoseconds per frame so far, and how many frames that is. */
    var meanNs = 0.0
    var n = 0
  }

  private val lock = Object()
  private val workers = mutableListOf(Worker(fast))
  private val pool = Executors.newCachedThreadPool { r -> Thread(r, "BoingPoseInfer") }
  private var closed = false

  /** Helpers that joined. */
  val helpers: Int
    get() = synchronized(lock) { workers.size - 1 }

  /** Frames the helpers measured. */
  var helperFrames = 0
    private set

  /** Adds a loaded helper; false (and the caller frees it) when the video is already done. */
  fun add(helper: VideoLandmarker): Boolean = synchronized(lock) {
    if (closed) return false
    workers.add(Worker(helper))
    lock.notifyAll()
    true
  }

  /**
   * Starts the pose of `bitmap` (waits until a landmarker can take it). `framesLeft`: about how many frames come after
   * this one. The future gives the landmarks, or null when no person was found.
   */
  fun submit(bitmap: Bitmap, tSeconds: Double, framesLeft: Double): Future<DoubleArray?> {
    val w: Worker
    synchronized(lock) {
      while (true) {
        val free = workers.withIndex().firstOrNull { (i, x) -> !x.busy && (i == 0 || worthHelping(x, framesLeft)) }
        if (free != null) {
          w = free.value
          if (free.index > 0) helperFrames++
          break
        }
        lock.wait()
      }
      w.busy = true
    }
    return pool.submit<DoubleArray?> {
      val t0 = System.nanoTime()
      try {
        w.landmarker.detect(bitmap, tSeconds)
      } finally {
        val dt = (System.nanoTime() - t0).toDouble()
        synchronized(lock) {
          w.n++
          w.meanNs += (dt - w.meanNs) / w.n
          w.busy = false
          lock.notifyAll()
        }
      }
    }
  }

  /** The helper finishes a frame before the fast one gets through the frames still to come (until both are timed: yes). */
  private fun worthHelping(helper: Worker, framesLeft: Double): Boolean {
    val fast = workers[0]
    return fast.n == 0 || helper.n == 0 || framesLeft * fast.meanNs >= helper.meanNs
  }

  /** Waits for the frames still being measured, then frees the helpers (not `fast`: that's the caller's). */
  override fun close() {
    val helpers = synchronized(lock) {
      closed = true
      workers.drop(1)
    }
    pool.shutdown()
    val done = try {
      pool.awaitTermination(30, TimeUnit.SECONDS)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      false
    }
    // A landmarker freed while it still measures would crash the app; leave a stuck one to the garbage collector.
    if (done) helpers.forEach { it.landmarker.close() } else Log.w("BoingPose", "Pose inference still running at close; helpers not freed")
  }

  companion object {
    private const val GB = 1024L * 1024 * 1024

    /**
     * How many of the asked-for CPU helpers this phone gets: the fewer of what its cores and its memory allow.
     * - Cores: 2 are left for feeding the GPU, decoding and the app (camera preview, UI); each helper uses several more
     *   (on the 8-core tablet one CPU landmarker alone took 451 ms per frame, two together a frame every ≈ 260 ms, a
     *   third added only ≈ 10 %), so one helper per 3 further cores: 8 cores → 2, 6 → 1, 4 or fewer → none.
     * - Memory: each helper is one more heavy model (≈ 125 MB while measuring): none on Android's low-RAM devices, one
     *   below 3 GB, else as many as the cores allow.
     */
    fun helpersFor(asked: Int, cores: Int, totalMem: Long, lowRam: Boolean): Int {
      val byCores = maxOf(0, (cores - 2) / 3)
      val byMemory = if (lowRam) 0 else if (totalMem < 3 * GB) 1 else Int.MAX_VALUE
      return minOf(maxOf(0, asked), byCores, byMemory)
    }

    /** `helpersFor` with this phone's cores and memory. */
    fun helperLimit(asked: Int): Int {
      if (asked <= 0) return 0
      val am = NitroModules.applicationContext?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return 0
      val info = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
      val cores = cpuCores()
      val n = helpersFor(asked, cores, info.totalMem, am.isLowRamDevice)
      Log.i("BoingPose", "CPU helpers: $n of $asked ($cores cores, ${"%.1f".format(info.totalMem.toDouble() / GB)} GB" +
        "${if (am.isLowRamDevice) ", low-RAM device" else ""})")
      return n
    }

    /**
     * The phone's CPU cores, also those switched off for now (`availableProcessors` counts only the ones online, and
     * phones switch idle cores off): from /sys/devices/system/cpu/present, e.g. "0-7".
     */
    private fun cpuCores(): Int {
      val online = Runtime.getRuntime().availableProcessors()
      return try {
        val present = File("/sys/devices/system/cpu/present").readText().trim()
        // Ranges and single cores, e.g. "0-7" or "0-3,5".
        val n = present.split(",").sumOf { range ->
          val ends = range.split("-").map { it.trim().toInt() }
          ends.last() - ends.first() + 1
        }
        maxOf(n, online)
      } catch (_: Throwable) {
        online
      }
    }
  }
}
