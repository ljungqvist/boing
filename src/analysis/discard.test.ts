import { describe, expect, it } from "vitest";
import { discardFeedback } from "./discard";

describe("discardFeedback", () => {
  it("announces a failure only when a re-measurement from the recording ended without a height", () => {
    expect(discardFeedback({ refined: true, pending: 0 })).toBe("failure");
  });

  it("stays silent for a live candidate rejected without re-measurement, but clears a stale 'Measuring…'", () => {
    expect(discardFeedback({ refined: false, pending: 0 })).toBe("clear-measuring");
  });

  it("leaves the display alone while another jump is still being measured", () => {
    expect(discardFeedback({ refined: true, pending: 1 })).toBe("none");
    expect(discardFeedback({ refined: false, pending: 2 })).toBe("none");
  });
});
