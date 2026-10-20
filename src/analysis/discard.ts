/** What to show when a jump was discarded (no height to report). */
export type DiscardFeedback =
  /** "Couldn't measure" flash and spoken notice. */
  | "failure"
  /** Silent; only removes a stale "Measuring…" flash. */
  | "clear-measuring"
  /** Nothing: another jump is still being measured, its result decides. */
  | "none";

/**
 * Only a re-measurement from the recording (`refined`) that ends without a height is announced as a
 * failure. A live candidate rejected straight away is just listed as ignored: the live tracker rejects
 * many movements (camera nudged, walking in and out of view) and must not shout about each of them.
 */
export function discardFeedback(d: { refined: boolean; pending: number }): DiscardFeedback {
  if (d.pending > 0) return "none";
  return d.refined ? "failure" : "clear-measuring";
}
