/** Spoken result + short sound, and keeping the screen awake during a session. */
export class Feedback {
  private audio: AudioContext | null = null;

  constructor(public enabled: boolean) {}

  /** Must run inside a user gesture (e.g. the Start tap), or mobile browsers stay silent. */
  prime(): void {
    if (!this.audio) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) this.audio = new Ctx();
    }
    void this.audio?.resume();
    if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  }

  announce(heightM: number): void {
    if (!this.enabled) return;
    this.beep();
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance((heightM * 100).toFixed(1));
      u.lang = "en-US";
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
  }

  /** A movement was seen but no height could be determined. */
  announceFailure(): void {
    if (!this.enabled || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance("Couldn't determine the height");
    u.lang = "en-US";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  private beep(): void {
    const ctx = this.audio;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // A short rising "boing".
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.26);
  }
}

/** Screen wake lock that is re-acquired when the page becomes visible again. */
export class WakeLock {
  private lock: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (this.wanted && document.visibilityState === "visible") void this.acquire();
    });
  }

  async acquire(): Promise<void> {
    this.wanted = true;
    try {
      this.lock = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      this.lock = null; // not supported or not allowed: the screen may dim, nothing else breaks
    }
  }

  release(): void {
    this.wanted = false;
    void this.lock?.release();
    this.lock = null;
  }
}
