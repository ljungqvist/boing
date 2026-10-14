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
import java.nio.channels.FileChannel

/** Number of MediaPipe pose landmarks, and values per landmark (x, y, z, visibility). */
const val LANDMARKS = 33
const val VALUES = 4

/** A MediaPipe pose landmarker in VIDEO mode, with strictly increasing timestamps. */
class VideoLandmarker private constructor(
  private val landmarker: PoseLandmarker,
  val delegate: String,
) {
  private var lastMs = -1L

  /** Landmarks (33 × 4 values) of the bitmap at `tSeconds`, or null when no person was found. */
  fun detect(bitmap: Bitmap, tSeconds: Double): DoubleArray? {
    // MediaPipe needs strictly increasing timestamps; a jump backwards (new timeline) continues after the last one.
    val ms = maxOf(Math.round(tSeconds * 1000.0), lastMs + 1)
    lastMs = ms
    val result = landmarker.detectForVideo(BitmapImageBuilder(bitmap).build(), ms)
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

  fun close() = landmarker.close()

  companion object {
    private const val TAG = "BoingPose"

    /** Loads the `.task` model; GPU first when asked, the CPU if the GPU fails. */
    fun create(modelPath: String, preferGpu: Boolean): VideoLandmarker {
      val context = NitroModules.applicationContext ?: throw Error("No Android context available")
      val file = File(modelPath.removePrefix("file://"))
      if (!file.exists()) throw Error("Pose model not found: $modelPath")
      val buffer = RandomAccessFile(file, "r").use { f ->
        f.channel.map(FileChannel.MapMode.READ_ONLY, 0, f.length())
      }
      val delegates = if (preferGpu) listOf(Delegate.GPU, Delegate.CPU) else listOf(Delegate.CPU)
      var last: Throwable? = null
      for (d in delegates) {
        try {
          val base = BaseOptions.builder().setModelAssetBuffer(buffer).setDelegate(d).build()
          val options = PoseLandmarker.PoseLandmarkerOptions.builder()
            .setBaseOptions(base)
            .setRunningMode(RunningMode.VIDEO)
            .setNumPoses(1)
            .build()
          return VideoLandmarker(PoseLandmarker.createFromOptions(context, options), d.name)
        } catch (e: Throwable) {
          Log.w(TAG, "Pose landmarker with $d failed", e)
          last = e
        }
      }
      throw Error("Could not start the pose model: ${last?.message}")
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
