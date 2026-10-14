// Prints the text in an image (macOS Vision), e.g. a simulator screenshot in CI logs.
//   swift scripts/ocr.swift screenshot.png
import Foundation
import Vision

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
try VNImageRequestHandler(url: url).perform([request])
for o in request.results ?? [] {
  if let text = o.topCandidates(1).first?.string { print(text) }
}
