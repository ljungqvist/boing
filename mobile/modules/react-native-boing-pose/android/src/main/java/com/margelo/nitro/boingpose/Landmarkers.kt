package com.margelo.nitro.boingpose

import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.margelo.nitro.NitroModules
import java.io.File
import java.io.RandomAccessFile
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

/** Number of MediaPipe pose landmarks, and values per landmark (x, y, z, visibility). */
const val LANDMARKS = 33
const val VALUES = 4

private const val TAG = "BoingPose"

/**
 * A MediaPipe pose landmarker in VIDEO mode, with strictly increasing timestamps.
 * The GPU can fail at creation or only at the first inference (some GL drivers): either way
 * it falls back to the CPU and keeps going.
 */
class VideoLandmarker private constructor(private val model: MappedByteBuffer, preferGpu: Boolean) {
  private var delegateUsed: Delegate = if (preferGpu) Delegate.GPU else Delegate.CPU
  private var landmarker: PoseLandmarker = open()
  private var lastMs = -1L
  private var proven = false

  val delegate: String
    get() = delegateUsed.name

  private fun open(): PoseLandmarker {
    try {
      return build(delegateUsed)
    } catch (e: Throwable) {
      if (delegateUsed == Delegate.CPU) throw Error("Could not start the pose model: ${e.message}")
      Log.w(TAG, "Pose landmarker on the GPU failed, using the CPU", e)
      delegateUsed = Delegate.CPU
      return build(Delegate.CPU)
    }
  }

  private fun build(d: Delegate): PoseLandmarker {
    val context = NitroModules.applicationContext ?: throw Error("No Android context available")
    val base = BaseOptions.builder().setModelAssetBuffer(model).setDelegate(d).build()
    val options = PoseLandmarker.PoseLandmarkerOptions.builder()
      .setBaseOptions(base)
      .setRunningMode(RunningMode.VIDEO)
      .setNumPoses(1)
      .build()
    return PoseLandmarker.createFromOptions(context, options)
  }

  /** Landmarks (33 × 4 values) of the bitmap at `tSeconds`, or null when no person was found. */
  fun detect(bitmap: Bitmap, tSeconds: Double): DoubleArray? {
    // MediaPipe needs strictly increasing timestamps; a jump backwards (new timeline) continues after the last one.
    val ms = maxOf(Math.round(tSeconds * 1000.0), lastMs + 1)
    lastMs = ms
    val result = try {
      landmarker.detectForVideo(BitmapImageBuilder(bitmap).build(), ms)
    } catch (e: Throwable) {
      if (proven || delegateUsed == Delegate.CPU) throw e
      Log.w(TAG, "Pose inference on the GPU failed, using the CPU", e)
      closeQuietly(landmarker)
      delegateUsed = Delegate.CPU
      landmarker = build(Delegate.CPU)
      lastMs = ms
      landmarker.detectForVideo(BitmapImageBuilder(bitmap).build(), ms)
    }
    proven = true
    val pose = result.landmarks().firstOrNull() ?: return null
    val out = DoubleArray(LANDMARKS * VALUES)
    for (i in 0 until minOf(LANDMARKS, pose.size)) {
      val p = pose[i]
      out[i * VALUES] = p.x().toDouble()
      out[i * VALUES + 1] = p.y().toDouble()
      out[i * VALUES + 2] = p.z().toDouble()
      out[i * VALUES + 3] = p.visibility().orElse(0f).toDouble()
    }
    return out
  }

  fun close() = closeQuietly(landmarker)

  companion object {
    /** Loads the `.task` model; GPU first when asked. */
    fun create(modelPath: String, preferGpu: Boolean): VideoLandmarker {
      val file = File(modelPath.removePrefix("file://"))
      if (!file.exists()) throw Error("Pose model not found: $modelPath")
      val buffer = RandomAccessFile(file, "r").use { f ->
        f.channel.map(FileChannel.MapMode.READ_ONLY, 0, f.length())
      }
      return VideoLandmarker(buffer, preferGpu)
    }

    private fun closeQuietly(l: PoseLandmarker) {
      try {
        l.close()
      } catch (e: Throwable) {
        // Closing reports errors of earlier inferences again; nothing left to do about them.
        Log.w(TAG, "Closing the pose landmarker", e)
      }
    }
  }
}

/** The bitmap rotated clockwise by `degrees` (a multiple of 90); the same bitmap for 0. */
fun Bitmap.rotated(degrees: Int): Bitmap {
  val d = ((degrees % 360) + 360) % 360
  if (d == 0) return this
  val m = Matrix().apply { postRotate(d.toFloat()) }
  return Bitmap.createBitmap(this, 0, 0, width, height, m, true)
}
