/** What to show when a jump was discarded (no height to report). */
export type DiscardFeedback =
  /** "Couldn't measure" flash and spoken notice. */
  | "failure"
  /** Silent; only removes a stale "Measuring…" flash. */
  | "clear-measuring"
  /** Nothing: another jump is still being measured, its result decides. */
  | "none";

/**
 * A jump that was announced as "Measuring…" always gets an outcome: its height, or this failure, also
 * when re-measuring the recording failed (no recording, timeout) and the live fallback is rejected too.
 * A live candidate rejected straight away (`measuring` false) is just listed as ignored: the live
 * tracker rejects many movements (camera nudged, walking in and out of view) and must not shout about
 * each of them.
 */
export function discardFeedback(d: { measuring: boolean; pending: number }): DiscardFeedback {
  if (d.pending > 0) return "none";
  return d.measuring ? "failure" : "clear-measuring";
}
