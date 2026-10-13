/** A recorded piece of the camera stream; times in seconds on the live (camera) timeline. */
export interface Piece {
  start: number;
  end: number;
  /** The recording, once the piece has finished; null while it is still recording. */
  blob: Blob | null;
}

/**
 * The finished piece that contains `[from − margin, to + margin]`, preferring the one
 * where the window is most central. Null if no finished piece covers it (yet).
 */
export function choosePiece(pieces: Piece[], from: number, to: number, margin = 0.3): Piece | null {
  let best: Piece | null = null;
  let bestSlack = -Infinity;
  for (const p of pieces) {
    if (!p.blob || p.start > from - margin || p.end < to + margin) continue;
    const slack = Math.min(from - p.start, p.end - to); // room on the tighter side
    if (slack > bestSlack) [best, bestSlack] = [p, slack];
  }
  return best;
}

const MIME_TYPES = ["video/webm;codecs=vp8", "video/webm", "video/mp4"];

/** The first recording format the browser supports, or null. */
export function pickMimeType(isTypeSupported: (type: string) => boolean): string | null {
  return MIME_TYPES.find((t) => isTypeSupported(t)) ?? null;
}

export interface RecorderOptions {
  /** Length of each piece, seconds. */
  piece?: number;
  /** A new piece starts this often, seconds. Windows up to `piece − stagger` fit in one piece. */
  stagger?: number;
  /** Finished pieces kept; older ones are dropped. */
  keep?: number;
  /** Current time on the live timeline, seconds (default: `performance.now()`). */
  clock?: () => number;
}

/**
 * Records the camera stream continuously in overlapping pieces, so that any recent
 * moment can be re-analysed from a complete, playable recording. One MediaRecorder
 * can't yield a playable clip from the middle, hence a new recorder every `stagger` s.
 */
export class RollingRecorder {
  static supported(): boolean {
    return typeof MediaRecorder !== "undefined" && pickMimeType((t) => MediaRecorder.isTypeSupported(t)) !== null;
  }

  readonly mimeType: string | null;
  /** Set when recording failed; no new pieces are started. */
  error: string | null = null;
  private readonly length: number;
  private readonly stagger: number;
  private readonly keep: number;
  private readonly clock: () => number;
  private list: Piece[] = [];
  /** Recorders still running, with their piece. */
  private active = new Map<MediaRecorder, Piece>();
  private timers: number[] = [];
  private interval: number | undefined;
  private running = false;

  constructor(private readonly stream: MediaStream, opts: RecorderOptions = {}) {
    this.length = opts.piece ?? 6;
    this.stagger = opts.stagger ?? 3;
    this.keep = opts.keep ?? 4;
    this.clock = opts.clock ?? (() => performance.now() / 1000);
    this.mimeType = typeof MediaRecorder === "undefined" ? null : pickMimeType((t) => MediaRecorder.isTypeSupported(t));
  }

  start(): void {
    if (this.running || !this.mimeType) return;
    this.running = true;
    this.startPiece();
    this.interval = window.setInterval(() => this.startPiece(), this.stagger * 1000);
  }

  stop(): void {
    this.running = false;
    clearInterval(this.interval);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    for (const r of this.active.keys()) this.end(r);
  }

  /** Kept pieces, oldest first; the newest may still be recording (`blob` null). */
  pieces(): Piece[] {
    return [...this.list];
  }

  private startPiece(): void {
    if (!this.running || this.error) return;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(this.stream, { mimeType: this.mimeType!, videoBitsPerSecond: 4_000_000 });
    } catch (e) {
      this.fail(e);
      return;
    }
    const chunks: Blob[] = [];
    const piece: Piece = { start: NaN, end: Infinity, blob: null };
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstart = () => {
      piece.start = this.clock();
      this.list.push(piece);
      const timer = window.setTimeout(() => {
        this.timers = this.timers.filter((t) => t !== timer);
        this.end(rec);
      }, this.length * 1000);
      this.timers.push(timer);
    };
    rec.onstop = () => {
      this.active.delete(rec);
      if (!Number.isFinite(piece.end)) piece.end = this.clock();
      if (chunks.length) piece.blob = new Blob(chunks, { type: rec.mimeType || this.mimeType! });
      else this.list = this.list.filter((p) => p !== piece);
      this.prune();
    };
    rec.onerror = (e) => this.fail((e as unknown as { error?: unknown }).error ?? e);
    this.active.set(rec, piece);
    try {
      rec.start();
    } catch (e) {
      this.active.delete(rec);
      this.fail(e);
    }
  }

  /** Stop a recorder; its piece ends now (the blob follows in `onstop`). */
  private end(rec: MediaRecorder): void {
    if (rec.state === "inactive") return;
    const piece = this.active.get(rec);
    if (piece) piece.end = this.clock();
    rec.stop();
  }

  private prune(): void {
    const done = this.list.filter((p) => p.blob);
    const drop = new Set(done.slice(0, Math.max(0, done.length - this.keep)));
    this.list = this.list.filter((p) => !drop.has(p));
  }

  private fail(e: unknown): void {
    console.warn("recording failed", e);
    this.error = String((e as Error)?.message ?? e);
    this.stop();
  }
}
