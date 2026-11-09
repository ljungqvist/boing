import { describe, expect, it } from "vitest";
import { CONSENT_VERSION, consentText, hasConsent, hasRecordedConsent, isPhoneId, keepActive, newPhoneId, shouldAskConsent, uploadFolder } from "./consent";

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

  it("requires renewed agreement from version 2 contributors before keeping recordings", () => {
    const previous = { keep: true, consent: { version: 2, at: "2026-11-09" }, consentAsked: 2 };
    expect(keepActive(previous)).toBe(false);
    expect(shouldAskConsent(previous)).toBe(true);
  });

  it("retains access to withdrawal for old consent without granting upload permission", () => {
    expect(hasRecordedConsent).toBeTypeOf("function");
    const previous = { keep: true, consent: { version: 2, at: "2026-11-09" }, consentAsked: CONSENT_VERSION };
    expect(hasRecordedConsent(previous)).toBe(true);
    expect(keepActive(previous)).toBe(false);
    expect(hasRecordedConsent({ consent: { version: CONSENT_VERSION, at: "x" } })).toBe(true);
    expect(hasRecordedConsent({})).toBe(false);
    expect(hasRecordedConsent({ consent: null })).toBe(false);
    expect(hasRecordedConsent({ consent: { version: 0 } })).toBe(false);
  });

  it("discloses Anthropic review, overseas processing and separate cloud retention", () => {
    const t = consentText("0123456789ab").join("\n");
    expect(t).toContain("Anthropic");
    expect(t).toContain("United States");
    expect(t).toContain("model training");
    expect(t).toContain("cloud copies");
    expect(t).not.toContain("not shared with anyone");
  });

  it("includes the published privacy policy in the disclosure", () => {
    expect(consentText("0123456789ab").join("\n")).toContain("https://ljungqvist.info/boing/privacy/");
  });

  it("asks at first start, and again only when the consent version changes", () => {
    expect(shouldAskConsent({})).toBe(true);
    expect(shouldAskConsent({ consentAsked: CONSENT_VERSION })).toBe(false); // said "Not now" / withdrew
    expect(shouldAskConsent({ consentAsked: CONSENT_VERSION - 1 })).toBe(true); // text changed since
    expect(shouldAskConsent({ consent: { version: CONSENT_VERSION, at: "x" } })).toBe(false);
    expect(shouldAskConsent({ consent: { version: CONSENT_VERSION - 1, at: "x" } })).toBe(true);
  });
});
