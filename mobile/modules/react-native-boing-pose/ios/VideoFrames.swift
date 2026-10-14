import Accelerate
import AVFoundation
import CoreMedia
import CoreVideo
import Foundation

func openVideo(_ path: String) throws -> (AVURLAsset, AVAssetTrack) {
  let url = path.hasPrefix("file://") ? (URL(string: path) ?? URL(fileURLWithPath: String(path.dropFirst(7))))
    : URL(fileURLWithPath: path)
  let asset = AVURLAsset(url: url)
  guard let track = asset.tracks(withMediaType: .video).first else {
    throw boingError("No video track in \(path)")
  }
  return (asset, track)
}

func readVideoInfo(_ path: String) throws -> VideoInfo {
  let (asset, track) = try openVideo(path)
  // Count samples and their time span directly (compressed samples, no decoding): exact for
  // variable frame rates.
  let reader = try AVAssetReader(asset: asset)
  let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
  output.alwaysCopiesSampleData = false
  reader.add(output)
  guard reader.startReading() else {
    throw boingError("Cannot read this video: \(reader.error?.localizedDescription ?? "unknown error")")
  }
  var times: [Double] = []
  while true {
    let more: Bool = autoreleasepool {
      guard let sample = output.copyNextSampleBuffer() else { return false }
      if CMSampleBufferGetNumSamples(sample) > 0 {
        let t = CMSampleBufferGetPresentationTimeStamp(sample).seconds
        if t.isFinite { times.append(t) }
      }
      return true
    }
    if !more { break }
  }
  reader.cancelReading()
  // Samples come in decode order; presentation order is sorted time.
  times.sort()
  let count = times.count
  let span = count > 1 ? times[count - 1] - times[0] : 0
  let fps = span > 0 ? Double(count - 1) / span : Double(track.nominalFrameRate)
  var gaps: [Double] = []
  for i in 1..<max(1, count) where times[i] > times[i - 1] {
    gaps.append(times[i] - times[i - 1])
  }
  gaps.sort()
  let peakFps = gaps.isEmpty ? fps : 1 / gaps[gaps.count / 20]
  let rotation = rotationDegrees(track.preferredTransform)
  let sideways = Int(rotation) % 180 != 0
  let size = track.naturalSize
  let duration = asset.duration.seconds
  return VideoInfo(
    width: Double(sideways ? size.height : size.width),
    height: Double(sideways ? size.width : size.height),
    duration: duration.isFinite && duration > 0 ? duration : span,
    frameCount: Double(count), fps: fps, peakFps: peakFps,
    // iPhone files store no separate capture rate (that is Android's slow-motion metadata).
    captureFps: 0, rotation: rotation)
}

/// Degrees the stored frames must be rotated clockwise to display upright.
func rotationDegrees(_ t: CGAffineTransform) -> Double {
  let angle = atan2(Double(t.b), Double(t.a)) * 180 / .pi
  let d = (angle + 360).truncatingRemainder(dividingBy: 360)
  // Snap to a multiple of 90 (stored transforms are exact rotations, maybe mirrored).
  return ((d / 90).rounded() * 90).truncatingRemainder(dividingBy: 360)
}

/// The BGRA pixel buffer rotated clockwise by `degrees` (a multiple of 90); the same buffer for 0.
/// MediaPipe's landmarks are relative to the image it is given, so it must see the frame upright.
func rotated(_ src: CVPixelBuffer, degrees: Int) throws -> CVPixelBuffer {
  let d = ((degrees % 360) + 360) % 360
  if d == 0 { return src }
  let w = CVPixelBufferGetWidth(src), h = CVPixelBufferGetHeight(src)
  let (dw, dh) = d == 180 ? (w, h) : (h, w)
  var out: CVPixelBuffer?
  let attrs = [
    kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
    kCVPixelBufferMetalCompatibilityKey as String: true,
  ] as CFDictionary
  guard CVPixelBufferCreate(nil, dw, dh, kCVPixelFormatType_32BGRA, attrs, &out) == kCVReturnSuccess,
        let dst = out else {
    throw boingError("Cannot allocate a \(dw)×\(dh) frame")
  }
  CVPixelBufferLockBaseAddress(src, .readOnly)
  CVPixelBufferLockBaseAddress(dst, [])
  defer {
    CVPixelBufferUnlockBaseAddress(dst, [])
    CVPixelBufferUnlockBaseAddress(src, .readOnly)
  }
  var from = vImage_Buffer(
    data: CVPixelBufferGetBaseAddress(src), height: vImagePixelCount(h), width: vImagePixelCount(w),
    rowBytes: CVPixelBufferGetBytesPerRow(src))
  var to = vImage_Buffer(
    data: CVPixelBufferGetBaseAddress(dst), height: vImagePixelCount(dh), width: vImagePixelCount(dw),
    rowBytes: CVPixelBufferGetBytesPerRow(dst))
  let turn: Int = d == 90 ? kRotate90DegreesClockwise : d == 180 ? kRotate180DegreesClockwise : kRotate270DegreesClockwise
  var black: [UInt8] = [0, 0, 0, 255]
  let err = vImageRotate90_ARGB8888(&from, &to, UInt8(turn), &black, vImage_Flags(kvImageNoFlags))
  if err != kvImageNoError {
    throw boingError("Rotating a frame failed (vImage error \(err))")
  }
  return dst
}
