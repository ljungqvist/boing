import Foundation
import MediaPipeTasksVision
import UIKit

/// Number of MediaPipe pose landmarks, and values per landmark (x, y, z, visibility).
let landmarkCount = 33
let landmarkValues = 4

/// A MediaPipe pose landmarker in VIDEO mode, with strictly increasing timestamps.
final class VideoLandmarker {
  private let landmarker: PoseLandmarker
  let delegate: String
  private var lastMs = -1

  private init(landmarker: PoseLandmarker, delegate: String) {
    self.landmarker = landmarker
    self.delegate = delegate
  }

  /// Loads the `.task` model; GPU first when asked, the CPU if the GPU fails.
  static func create(modelPath: String, preferGpu: Bool) throws -> VideoLandmarker {
    let path = modelPath.hasPrefix("file://") ? String(modelPath.dropFirst(7)) : modelPath
    guard FileManager.default.fileExists(atPath: path) else {
      throw NSError(domain: "BoingPose", code: 1, userInfo: [NSLocalizedDescriptionKey: "Pose model not found: \(path)"])
    }
    let delegates: [(Delegate, String)] = preferGpu ? [(.GPU, "GPU"), (.CPU, "CPU")] : [(.CPU, "CPU")]
    var lastError: Error?
    for (d, name) in delegates {
      do {
        let options = PoseLandmarkerOptions()
        options.baseOptions.modelAssetPath = path
        options.baseOptions.delegate = d
        options.runningMode = .video
        options.numPoses = 1
        return VideoLandmarker(landmarker: try PoseLandmarker(options: options), delegate: name)
      } catch {
        lastError = error
      }
    }
    throw lastError ?? NSError(domain: "BoingPose", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not start the pose model"])
  }

  /// Landmarks (33 × 4 values) of the image at `t` seconds, or nil when no person was found.
  func detect(_ image: MPImage, t: Double) throws -> [Double]? {
    // MediaPipe needs strictly increasing timestamps; a jump backwards continues after the last one.
    let ms = max(Int((t * 1000).rounded()), lastMs + 1)
    lastMs = ms
    let result = try landmarker.detect(videoFrame: image, timestampInMilliseconds: ms)
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
