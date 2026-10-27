import { describe, expect, it } from "vitest";
import { CONSENT_VERSION, consentText, hasConsent, isPhoneId, keepActive, newPhoneId, uploadFolder } from "./consent";

describe("consent", () => {
  it("makes 12 hex character phone IDs", () => {
    expect(isPhoneId(newPhoneId())).toBe(true);
    expect(newPhoneId(() => 0)).toBe("000000000000");
    expect(newPhoneId(() => 0.999)).toBe("ffffffffffff");
    expect(isPhoneId("abc")).toBe(false);
    expect(isPhoneId("ABCDEF123456")).toBe(false);
  });

  it("counts only consent to the current text", () => {
    expect(hasConsent({})).toBe(false);
    expect(hasConsent({ consent: null })).toBe(false);
    expect(hasConsent({ consent: { version: CONSENT_VERSION - 1, at: "x" } })).toBe(false);
    expect(hasConsent({ consent: { version: CONSENT_VERSION, at: "x" } })).toBe(true);
  });

  it("keeps recordings only when switched on and agreed", () => {
    const consent = { version: CONSENT_VERSION, at: "x" };
    expect(keepActive({ keep: true })).toBe(false);
    expect(keepActive({ keep: false, consent })).toBe(false);
    expect(keepActive({ keep: true, consent })).toBe(true);
  });

  it("names upload folders by time, then phone", () => {
    expect(uploadFolder("2026-10-24_101500", "0123456789ab")).toBe("2026-10-24_101500_0123456789ab");
  });

  it("tells that recordings are sent automatically, also over mobile data", () => {
    const t = consentText("0123456789ab").join("\n");
    expect(t).toContain("automatically");
    expect(t).toContain("mobile data");
    expect(t).not.toContain("Send recordings");
  });

  it("shows the recording ID and the contact in the text", () => {
    const t = consentText("0123456789ab").join("\n");
    expect(t).toContain("0123456789ab");
    expect(t).toContain("boing@ljungqvist.info");
  });
});
