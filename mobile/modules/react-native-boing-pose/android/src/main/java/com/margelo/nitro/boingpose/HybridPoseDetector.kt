package com.margelo.nitro.boingpose

import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.public.NativeFrame

/** Live pose detection on VisionCamera frames (called synchronously from the frame worklet). */
class HybridPoseDetector(modelPath: String, preferGpu: Boolean) : HybridPoseDetectorSpec() {
  private val landmarker = VideoLandmarker.create(modelPath, preferGpu)
  private var closed = false
  /** Time of the last analysed frame (seconds). */
  private var lastT = Double.NEGATIVE_INFINITY

  @Volatile
  override var minInterval: Double = 0.0

  override val delegate: String
    get() = landmarker.delegate

  override fun detect(frame: HybridFrameSpec): DoubleArray {
    val native = frame as? NativeFrame ?: throw Error("Frame is not a NativeFrame")
    val image = native.image
    // Sensor timestamp in nanoseconds; the same clock for every frame of a session.
    val t = image.imageInfo.timestamp / 1e9
    if (t - lastT < minInterval - 0.0005) return DoubleArray(0)
    lastT = t
    // toBitmap() handles RGBA_8888 and YUV_420_888; rotate to upright so "y" is vertical.
    val bitmap = image.toBitmap().rotated(image.imageInfo.rotationDegrees)
    val head = doubleArrayOf(t, bitmap.width.toDouble(), bitmap.height.toDouble())
    synchronized(this) {
      if (closed) return head
      val lm = landmarker.detect(bitmap, t) ?: return head
      return head + lm
    }
  }

  override fun close() {
    synchronized(this) {
      if (closed) return
      closed = true
      landmarker.close()
    }
  }

  override fun dispose() {
    close()
    super.dispose()
  }
}
