import AVFoundation
import Foundation
import MediaPipeTasksVision
import NitroModules
import VisionCamera

/// Live pose detection on VisionCamera frames (called synchronously from the frame worklet).
/// The frame output uses physical buffer rotation (BGRA), so frames are upright.
class HybridPoseDetector: HybridPoseDetectorSpec {
  private let landmarker: VideoLandmarker
  private let lock = NSLock()
  private var closed = false
  /// Time of the last analysed frame (seconds).
  private var lastT = -Double.infinity

  var minInterval: Double = 0

  init(modelPath: String, preferGpu: Bool) throws {
    landmarker = try VideoLandmarker.create(modelPath: modelPath, preferGpu: preferGpu)
    super.init()
  }

  var delegate: String { landmarker.delegate }

  func detect(frame: (any HybridFrameSpec)) throws -> [Double] {
    guard let native = frame as? any NativeFrame, let sampleBuffer = native.sampleBuffer else {
      throw RuntimeError.error(withMessage: "Frame has no sample buffer")
    }
    let t = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
    if t - lastT < minInterval - 0.0005 { return [] }
    lastT = t
    var width = 0.0, height = 0.0
    if let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) {
      width = Double(CVPixelBufferGetWidth(pixels))
      height = Double(CVPixelBufferGetHeight(pixels))
    }
    let head = [t, width, height]
    lock.lock()
    defer { lock.unlock() }
    if closed { return head }
    let image = try MPImage(sampleBuffer: sampleBuffer, orientation: .up)
    guard let lm = try landmarker.detect(image, t: t) else { return head }
    return head + lm
  }

  func close() throws {
    lock.lock()
    closed = true
    lock.unlock()
  }
}
