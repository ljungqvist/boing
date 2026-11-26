import Foundation
import MediaPipeTasksVision
import UIKit

/// Number of MediaPipe pose landmarks, and values per landmark (x, y, z, visibility).
let landmarkCount = 33
let landmarkValues = 4

func boingError(_ message: String) -> NSError {
  return NSError(domain: "BoingPose", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

/// A MediaPipe pose landmarker: in VIDEO mode (tracking the person from frame to frame, strictly increasing
/// timestamps), or with `perFrame` in IMAGE mode (every frame on its own: no tracking lag, no state).
/// The GPU can fail at creation or only at the first inference: either way it falls back to the
/// CPU and keeps going.
final class VideoLandmarker {
  private let path: String
  let perFrame: Bool
  private var landmarker: PoseLandmarker
  private(set) var delegate: String
  private var lastMs = -1
  private var proven = false

  private init(path: String, preferGpu: Bool, perFrame: Bool) throws {
    self.path = path
    self.perFrame = perFrame
    if preferGpu {
      do {
        landmarker = try VideoLandmarker.build(path, .GPU, perFrame)
        delegate = "GPU"
        return
      } catch {
        NSLog("BoingPose: pose landmarker on the GPU failed, using the CPU: \(error)")
      }
    }
    landmarker = try VideoLandmarker.build(path, .CPU, perFrame)
    delegate = "CPU"
  }

  private static func build(_ path: String, _ d: Delegate, _ perFrame: Bool) throws -> PoseLandmarker {
    let options = PoseLandmarkerOptions()
    options.baseOptions.modelAssetPath = path
    options.baseOptions.delegate = d
    options.runningMode = perFrame ? .image : .video
    options.numPoses = 1
    return try PoseLandmarker(options: options)
  }

  /// Loads the `.task` model; GPU first when asked; IMAGE mode with `perFrame`.
  static func create(modelPath: String, preferGpu: Bool, perFrame: Bool = false) throws -> VideoLandmarker {
    let path = modelPath.hasPrefix("file://") ? String(modelPath.dropFirst(7)) : modelPath
    guard FileManager.default.fileExists(atPath: path) else {
      throw boingError("Pose model not found: \(path)")
    }
    #if targetEnvironment(simulator)
    // The simulator's Metal can't wrap frames as textures: MediaPipe's GPU path aborts there
    // (copyCVMetalTextureWithGpuBuffer), which no fallback can catch.
    let gpu = false
    #else
    let gpu = preferGpu
    #endif
    do {
      return try VideoLandmarker(path: path, preferGpu: gpu, perFrame: perFrame)
    } catch {
      throw boingError("Could not start the pose model: \(error.localizedDescription)")
    }
  }

  /// Landmarks (33 × 4 values) of the upright image at `t` seconds, or nil when no person was found.
  func detect(_ image: MPImage, t: Double) throws -> [Double]? {
    // MediaPipe needs strictly increasing timestamps; a jump backwards continues after the last one.
    let ms = max(Int((t * 1000).rounded()), lastMs + 1)
    lastMs = ms
    let perFrame = self.perFrame
    let run = { (l: PoseLandmarker) throws -> PoseLandmarkerResult in
      if perFrame { return try l.detect(image: image) }
      return try l.detect(videoFrame: image, timestampInMilliseconds: ms)
    }
    let result: PoseLandmarkerResult
    do {
      result = try run(landmarker)
    } catch {
      if proven || delegate == "CPU" { throw error }
      NSLog("BoingPose: pose inference on the GPU failed, using the CPU: \(error)")
      landmarker = try VideoLandmarker.build(path, .CPU, perFrame)
      delegate = "CPU"
      result = try run(landmarker)
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
