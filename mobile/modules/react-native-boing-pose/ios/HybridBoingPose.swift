import AVFoundation
import Foundation
import MediaPipeTasksVision
import NitroModules
import UIKit

class HybridBoingPose: HybridBoingPoseSpec {
  // Crash reports are only recorded on Android so far.
  func lastCrash() throws -> String { "" }
  func clearCrash() throws {}

  func createDetector(modelPath: String, preferGpu: Bool) throws -> (any HybridPoseDetectorSpec) {
    return try HybridPoseDetector(modelPath: modelPath, preferGpu: preferGpu)
  }

  func videoInfo(path: String) throws -> VideoInfo {
    let (asset, track) = try openVideo(path)
    let size = track.naturalSize.applying(track.preferredTransform)
    let duration = asset.duration.seconds
    let fps = Double(track.nominalFrameRate)
    return VideoInfo(
      width: abs(size.width), height: abs(size.height), duration: duration,
      frameCount: (duration * fps).rounded(), fps: fps, peakFps: fps,
      // iPhone slow-motion files keep real-time timestamps; only Android stores a separate capture rate.
      captureFps: 0, rotation: rotationDegrees(track.preferredTransform)
    )
  }

  func analyzeVideo(path: String, options: AnalyzeOptions, onProgress: @escaping (Double) -> Void) throws -> Promise<AnalyzeResult> {
    return Promise.async {
      let (asset, track) = try openVideo(path)
      let landmarker = try VideoLandmarker.create(modelPath: options.modelPath, preferGpu: options.preferGpu)
      let orientation = imageOrientation(track.preferredTransform)
      let reader = try AVAssetReader(asset: asset)
      let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      ])
      output.alwaysCopiesSampleData = false
      reader.add(output)
      let from = max(0, options.from)
      let to = min(options.to, asset.duration.seconds + 1)
      reader.timeRange = CMTimeRange(
        start: CMTime(seconds: from, preferredTimescale: 600),
        end: CMTime(seconds: to, preferredTimescale: 600))
      guard reader.startReading() else {
        throw RuntimeError.error(withMessage: "Cannot read this video: \(reader.error?.localizedDescription ?? "unknown error")")
      }
      var times: [Double] = []
      var found: [Double] = []
      var landmarks: [Double] = []
      var width = 0.0, height = 0.0
      var last = -Double.infinity
      var reported = -1.0
      while let sample = output.copyNextSampleBuffer() {
        let t = CMSampleBufferGetPresentationTimeStamp(sample).seconds
        if !t.isFinite || t < from || t > to { continue }
        if t - last < options.minInterval - 0.0005 { continue }
        last = t
        if let pixels = CMSampleBufferGetImageBuffer(sample) {
          let w = Double(CVPixelBufferGetWidth(pixels)), h = Double(CVPixelBufferGetHeight(pixels))
          let sideways = orientation == .left || orientation == .right
          width = sideways ? h : w
          height = sideways ? w : h
        }
        let image = try MPImage(sampleBuffer: sample, orientation: orientation)
        let lm = try landmarker.detect(image, t: t)
        times.append(t)
        found.append(lm != nil ? 1 : 0)
        landmarks.append(contentsOf: lm ?? [Double](repeating: 0, count: landmarkCount * landmarkValues))
        let p = to > from ? (t - from) / (to - from) : 1
        if p - reported >= 0.01 {
          reported = p
          onProgress(min(1, max(0, p)))
        }
      }
      if reader.status == .failed {
        throw RuntimeError.error(withMessage: "Decoding failed: \(reader.error?.localizedDescription ?? "unknown error")")
      }
      return AnalyzeResult(
        width: width, height: height, times: times, found: found, landmarks: landmarks,
        delegate: landmarker.delegate)
    }
  }
}

private func openVideo(_ path: String) throws -> (AVURLAsset, AVAssetTrack) {
  let url = path.hasPrefix("file://") ? URL(string: path)! : URL(fileURLWithPath: path)
  let asset = AVURLAsset(url: url)
  guard let track = asset.tracks(withMediaType: .video).first else {
    throw RuntimeError.error(withMessage: "No video track in \(path)")
  }
  return (asset, track)
}

/// Degrees the stored frames must be rotated clockwise to display upright.
private func rotationDegrees(_ t: CGAffineTransform) -> Double {
  let angle = atan2(Double(t.b), Double(t.a)) * 180 / .pi
  return (angle + 360).truncatingRemainder(dividingBy: 360).rounded()
}

/// The `UIImage.Orientation` that MediaPipe needs to see the stored frames upright.
private func imageOrientation(_ t: CGAffineTransform) -> UIImage.Orientation {
  switch Int(rotationDegrees(t)) {
  case 90: return .right
  case 180: return .down
  case 270: return .left
  default: return .up
  }
}
