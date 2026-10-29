import AVFoundation
import Foundation
import MediaPipeTasksVision
import NitroModules

class HybridBoingPose: HybridBoingPoseSpec {
  override init() {
    CrashReports.install()
    super.init()
  }

  func lastCrash() throws -> String { CrashReports.last() }
  func clearCrash() throws { CrashReports.clear() }

  func createDetector(modelPath: String, preferGpu: Bool) throws -> (any HybridPoseDetectorSpec) {
    return try HybridPoseDetector(modelPath: modelPath, preferGpu: preferGpu)
  }

  func prepare(modelPath: String, preferGpu: Bool) throws {
    Prepared.shared.prepare(modelPath: modelPath, preferGpu: preferGpu)
  }

  func releasePrepared() throws {
    Prepared.shared.release()
  }

  func videoInfo(path: String) throws -> VideoInfo {
    return try readVideoInfo(path)
  }

  func analyzeVideo(path: String, options: AnalyzeOptions, onProgress: @escaping (Double) -> Void) throws -> Promise<AnalyzeResult> {
    return Promise.async {
      let start = CFAbsoluteTimeGetCurrent()
      let (asset, track) = try openVideo(path)
      let open0 = CFAbsoluteTimeGetCurrent()
      let prepared = Prepared.shared.take(modelPath: options.modelPath, preferGpu: options.preferGpu)
      let landmarker = try prepared ?? VideoLandmarker.create(modelPath: options.modelPath, preferGpu: options.preferGpu)
      let openS = CFAbsoluteTimeGetCurrent() - open0
      // The next video gets a fresh one (no tracking state carried over).
      defer { if prepared != nil { Prepared.shared.refill(modelPath: options.modelPath, preferGpu: options.preferGpu) } }
      let rotation = Int(rotationDegrees(track.preferredTransform))
      let reader = try AVAssetReader(asset: asset)
      // MediaPipe's GPU path wraps the frames in Metal textures: they must be IOSurface-backed and
      // Metal-compatible, else it aborts (not a catchable error).
      let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferMetalCompatibilityKey as String: true,
        kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
      ])
      output.alwaysCopiesSampleData = false
      reader.add(output)
      let from = max(0, options.from)
      let to = min(options.to, asset.duration.seconds + 1)
      reader.timeRange = CMTimeRange(
        start: CMTime(seconds: from, preferredTimescale: 600),
        end: CMTime(seconds: to, preferredTimescale: 600))
      guard reader.startReading() else {
        throw boingError("Cannot read this video: \(reader.error?.localizedDescription ?? "unknown error")")
      }
      var times: [Double] = []
      var found: [Double] = []
      var landmarks: [Double] = []
      var width = 0.0, height = 0.0
      var last = -Double.infinity
      var reported = -1.0
      var decodeS = 0.0, poseS = 0.0
      var decoded = 0
      while true {
        let more: Bool = try autoreleasepool {
          let d0 = CFAbsoluteTimeGetCurrent()
          guard let sample = output.copyNextSampleBuffer() else { return false }
          decoded += 1
          decodeS += CFAbsoluteTimeGetCurrent() - d0
          let t = CMSampleBufferGetPresentationTimeStamp(sample).seconds
          guard t.isFinite, t >= from, t <= to, t - last >= options.minInterval - 0.0005,
                let pixels = CMSampleBufferGetImageBuffer(sample) else { return true }
          last = t
          let r0 = CFAbsoluteTimeGetCurrent()
          let upright = try rotated(pixels, degrees: rotation)
          decodeS += CFAbsoluteTimeGetCurrent() - r0
          width = Double(CVPixelBufferGetWidth(upright))
          height = Double(CVPixelBufferGetHeight(upright))
          let p0 = CFAbsoluteTimeGetCurrent()
          let lm = try landmarker.detect(try MPImage(pixelBuffer: upright, orientation: .up), t: t)
          poseS += CFAbsoluteTimeGetCurrent() - p0
          times.append(t)
          found.append(lm != nil ? 1 : 0)
          landmarks.append(contentsOf: lm ?? [Double](repeating: 0, count: landmarkCount * landmarkValues))
          let p = to > from ? (t - from) / (to - from) : 1
          if p - reported >= 0.01 {
            reported = p
            onProgress(min(1, max(0, p)))
          }
          return true
        }
        if !more { break }
      }
      if reader.status == .failed {
        throw boingError("Decoding failed: \(reader.error?.localizedDescription ?? "unknown error")")
      }
      reader.cancelReading()
      let timing = AnalyzeTiming(
        openMs: openS * 1000, decodeMs: decodeS * 1000, poseMs: poseS * 1000,
        totalMs: (CFAbsoluteTimeGetCurrent() - start) * 1000, decoded: Double(decoded))
      return AnalyzeResult(
        width: width, height: height, times: times, found: found, landmarks: landmarks,
        delegate: landmarker.delegate, timing: timing)
    }
  }
}

/// One pose landmarker loaded ahead of time, on a queue of its own, for the next `analyzeVideo`
/// with the same model: loading the heavy model takes a while.
private final class Prepared {
  static let shared = Prepared()

  private let loader = DispatchQueue(label: "BoingPosePrepare")
  private let lock = NSLock()
  private var key: String?
  /// Filled on the loader queue; `ready` is signalled once it's there (or failed).
  private var slot: Slot?

  private final class Slot {
    let ready = DispatchSemaphore(value: 0)
    var landmarker: VideoLandmarker?
  }

  private static func keyOf(_ modelPath: String, _ preferGpu: Bool) -> String { "\(preferGpu) \(modelPath)" }

  func prepare(modelPath: String, preferGpu: Bool) {
    let k = Prepared.keyOf(modelPath, preferGpu)
    lock.lock()
    defer { lock.unlock() }
    if key == k {
      if slot == nil { slot = load(modelPath, preferGpu) }
      return
    }
    dropLocked()
    key = k
    slot = load(modelPath, preferGpu)
  }

  func release() {
    lock.lock()
    defer { lock.unlock() }
    key = nil
    dropLocked()
  }

  /// The prepared landmarker for this model (waits while it loads), or nil when there's none or it failed to load.
  func take(modelPath: String, preferGpu: Bool) -> VideoLandmarker? {
    lock.lock()
    guard key == Prepared.keyOf(modelPath, preferGpu), let s = slot else {
      lock.unlock()
      return nil
    }
    slot = nil
    lock.unlock()
    s.ready.wait()
    return s.landmarker
  }

  /// Loads the next one, if this model is still the prepared one.
  func refill(modelPath: String, preferGpu: Bool) {
    lock.lock()
    defer { lock.unlock() }
    if key == Prepared.keyOf(modelPath, preferGpu) && slot == nil { slot = load(modelPath, preferGpu) }
  }

  private func load(_ modelPath: String, _ preferGpu: Bool) -> Slot {
    let s = Slot()
    loader.async {
      s.landmarker = try? VideoLandmarker.create(modelPath: modelPath, preferGpu: preferGpu)
      s.ready.signal()
    }
    return s
  }

  /// Frees the prepared one once it has loaded (the loader runs one at a time). Call with `lock` held.
  private func dropLocked() {
    guard let s = slot else { return }
    slot = nil
    loader.async { s.landmarker = nil }
  }
}
