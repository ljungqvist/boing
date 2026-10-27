/**
 * Consent for debug recordings (GDPR): recordings are kept and sent only after the person agreed to
 * the current text. Bump CONSENT_VERSION whenever CONSENT_TEXT changes; the app then asks again.
 */

export const CONSENT_VERSION = 2;

export const CONTACT = "boing@ljungqvist.info";

export const CONSENT_TITLE = "Send recordings to the developer?";

/** The consent text, paragraph by paragraph. */
export function consentText(phoneId: string): string[] {
  return [
    "When this is on, Boing records each measured jump, with pose and motion data (body positions, " +
      "accelerometer, gyroscope), and sends it to the developer automatically right after the jump, in the " +
      "background, also over mobile data. A jump's video is typically 50-100 MB. A jump that can't be sent " +
      "stays on the phone and is sent later.",
    `Who: Petter Ljungqvist, Finland (${CONTACT}). Why: to test and improve the height measurement. ` +
      "Recordings are stored on the developer's own computers in Finland, not published and not shared " +
      "with anyone. They're kept at most 2 years; deleted data also disappears from backups as they're " +
      "replaced.",
    "Only record people who agree, and children only with a parent's permission.",
    `You can withdraw at any time in this menu and have everything you've sent deleted, or write to ${CONTACT}. ` +
      `Your recording ID: ${phoneId}.`,
    "Saying no changes nothing else in the app.",
  ];
}

export type Consent = { version: number; at: string };

/** A random recording ID for this phone: 12 lowercase hex characters. */
export function newPhoneId(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 12; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}

export function isPhoneId(x: unknown): x is string {
  return typeof x === "string" && /^[0-9a-f]{12}$/.test(x);
}

/** The person agreed to the current consent text. */
export function hasConsent(settings: Record<string, unknown>): boolean {
  const c = settings.consent as Partial<Consent> | undefined;
  return typeof c === "object" && c !== null && c.version === CONSENT_VERSION;
}

/** Recordings are kept: switched on and agreed to the current text. */
export function keepActive(settings: Record<string, unknown>): boolean {
  return settings.keep === true && hasConsent(settings);
}

/** The session's folder on the server: start time first (sorts by time), then the phone. */
export function uploadFolder(sessionId: string, phoneId: string): string {
  return `${sessionId}_${phoneId}`;
}
