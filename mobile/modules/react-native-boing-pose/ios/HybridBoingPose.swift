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

  func videoInfo(path: String) throws -> VideoInfo {
    return try readVideoInfo(path)
  }

  func analyzeVideo(path: String, options: AnalyzeOptions, onProgress: @escaping (Double) -> Void) throws -> Promise<AnalyzeResult> {
    return Promise.async {
      let (asset, track) = try openVideo(path)
      let landmarker = try VideoLandmarker.create(modelPath: options.modelPath, preferGpu: options.preferGpu)
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
      while true {
        let more: Bool = try autoreleasepool {
          guard let sample = output.copyNextSampleBuffer() else { return false }
          let t = CMSampleBufferGetPresentationTimeStamp(sample).seconds
          guard t.isFinite, t >= from, t <= to, t - last >= options.minInterval - 0.0005,
                let pixels = CMSampleBufferGetImageBuffer(sample) else { return true }
          last = t
          let upright = try rotated(pixels, degrees: rotation)
          width = Double(CVPixelBufferGetWidth(upright))
          height = Double(CVPixelBufferGetHeight(upright))
          let lm = try landmarker.detect(try MPImage(pixelBuffer: upright, orientation: .up), t: t)
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
      return AnalyzeResult(
        width: width, height: height, times: times, found: found, landmarks: landmarks,
        delegate: landmarker.delegate)
    }
  }
}
