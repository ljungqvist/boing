import Foundation
import MediaPipeTasksVision
import UIKit

/// Number of MediaPipe pose landmarks, and values per landmark (x, y, z, visibility).
let landmarkCount = 33
let landmarkValues = 4

func boingError(_ message: String) -> NSError {
  return NSError(domain: "BoingPose", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

/// A MediaPipe pose landmarker in VIDEO mode, with strictly increasing timestamps.
/// The GPU can fail at creation or only at the first inference: either way it falls back to the
/// CPU and keeps going.
final class VideoLandmarker {
  private let path: String
  private var landmarker: PoseLandmarker
  private(set) var delegate: String
  private var lastMs = -1
  private var proven = false

  private init(path: String, preferGpu: Bool) throws {
    self.path = path
    if preferGpu {
      do {
        landmarker = try VideoLandmarker.build(path, .GPU)
        delegate = "GPU"
        return
      } catch {
        NSLog("BoingPose: pose landmarker on the GPU failed, using the CPU: \(error)")
      }
    }
    landmarker = try VideoLandmarker.build(path, .CPU)
    delegate = "CPU"
  }

  private static func build(_ path: String, _ d: Delegate) throws -> PoseLandmarker {
    let options = PoseLandmarkerOptions()
    options.baseOptions.modelAssetPath = path
    options.baseOptions.delegate = d
    options.runningMode = .video
    options.numPoses = 1
    return try PoseLandmarker(options: options)
  }

  /// Loads the `.task` model; GPU first when asked.
  static func create(modelPath: String, preferGpu: Bool) throws -> VideoLandmarker {
    let path = modelPath.hasPrefix("file://") ? String(modelPath.dropFirst(7)) : modelPath
    guard FileManager.default.fileExists(atPath: path) else {
      throw boingError("Pose model not found: \(path)")
    }
    do {
      return try VideoLandmarker(path: path, preferGpu: preferGpu)
    } catch {
      throw boingError("Could not start the pose model: \(error.localizedDescription)")
    }
  }

  /// Landmarks (33 × 4 values) of the upright image at `t` seconds, or nil when no person was found.
  func detect(_ image: MPImage, t: Double) throws -> [Double]? {
    // MediaPipe needs strictly increasing timestamps; a jump backwards continues after the last one.
    let ms = max(Int((t * 1000).rounded()), lastMs + 1)
    lastMs = ms
    let result: PoseLandmarkerResult
    do {
      result = try landmarker.detect(videoFrame: image, timestampInMilliseconds: ms)
    } catch {
      if proven || delegate == "CPU" { throw error }
      NSLog("BoingPose: pose inference on the GPU failed, using the CPU: \(error)")
      landmarker = try VideoLandmarker.build(path, .CPU)
      delegate = "CPU"
      result = try landmarker.detect(videoFrame: image, timestampInMilliseconds: ms)
    }
    proven = true
    guard let pose = result.landmarks.first else { return nil }
    var out = [Double](repeating: 0, count: landmarkCount * landmarkValues)
    for (i, p) in pose.prefix(landmarkCount).enumerated() {
      out[i * landmarkValues] = Double(p.x)
      out[i * landmarkValues + 1] = Double(p.y)
      out[i * landmarkValues + 2] = Double(p.z)
      out[i * landmarkValues + 3] = p.visibility?.doubleValue ?? 0
    }
    return out
  }
}
