import { describe, expect, it } from "vitest";
import { discardFeedback } from "./discard";

describe("discardFeedback", () => {
  it("announces a failure for every jump shown as 'Measuring…' that ended without a height", () => {
    expect(discardFeedback({ measuring: true, pending: 0 })).toBe("failure");
  });

  it("stays silent for a live candidate rejected without 'Measuring…', but clears a stale one", () => {
    expect(discardFeedback({ measuring: false, pending: 0 })).toBe("clear-measuring");
  });

  it("leaves the display alone while another jump is still being measured", () => {
    expect(discardFeedback({ measuring: true, pending: 1 })).toBe("none");
    expect(discardFeedback({ measuring: false, pending: 2 })).toBe("none");
  });
});
