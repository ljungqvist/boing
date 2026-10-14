import Foundation

/// The handler that was installed before ours (called after recording).
private var previousHandler: (@convention(c) (NSException) -> Void)?

/// Records uncaught Objective-C exceptions (including React Native's fatal JS errors) to a file, so
/// the app can show the report on the next start. Native signals (Swift traps, EXC_BAD_ACCESS) are
/// not recorded: iOS keeps those under Settings → Privacy & Security → Analytics Data.
enum CrashReports {
  private static let name = "boing-crash.txt"
  private static var installed = false
  fileprivate static var device = ""

  fileprivate static func file() -> URL? {
    return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
      .appendingPathComponent(name)
  }

  static func install() {
    if installed { return }
    installed = true
    // Not UIDevice: it is main-thread only, and this runs on the JS thread.
    device = "\(modelIdentifier()), iOS \(ProcessInfo.processInfo.operatingSystemVersionString)"
    previousHandler = NSGetUncaughtExceptionHandler()
    NSSetUncaughtExceptionHandler { e in
      let time = ISO8601DateFormatter().string(from: Date())
      let text = "Boing crash, \(time)\nDevice: \(CrashReports.device)\nThread: \(Thread.current.name ?? "")\n\n"
        + "\(e.name.rawValue): \(e.reason ?? "")\n\n" + e.callStackSymbols.joined(separator: "\n")
      if let f = CrashReports.file() { try? text.write(to: f, atomically: true, encoding: .utf8) }
      previousHandler?(e)
    }
  }

  static func last() -> String {
    guard let f = file(), let text = try? String(contentsOf: f, encoding: .utf8) else { return "" }
    return text
  }

  static func clear() {
    if let f = file() { try? FileManager.default.removeItem(at: f) }
  }

  /// Hardware model, e.g. "iPad13,16".
  private static func modelIdentifier() -> String {
    var info = utsname()
    uname(&info)
    return withUnsafeBytes(of: &info.machine) { raw in
      String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
    }
  }
}
