import { describe, expect, it } from "vitest";
import { windowStart } from "@/lib/policy/windows";

describe("windowStart", () => {
  it("uses the mandate's local calendar", () => {
    // 02:00 UTC on Nov 1 is still Oct 31 in New York.
    const now = new Date("2026-11-01T02:00:00Z");
    expect(windowStart("month", now, "America/New_York")!.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(windowStart("day", now, "America/New_York")!.toISOString()).toBe("2026-10-31T04:00:00.000Z");
    expect(windowStart("month", now, "UTC")!.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("handles a day that starts in daylight time and ends in standard time", () => {
    // US DST ends Nov 1, 2026: local midnight is still EDT (UTC-4).
    const now = new Date("2026-11-01T20:00:00Z");
    expect(windowStart("day", now, "America/New_York")!.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("starts weeks on Monday", () => {
    // Wednesday Nov 4, 2026 in Lagos (UTC+1).
    const now = new Date("2026-11-04T12:00:00Z");
    expect(windowStart("week", now, "Africa/Lagos")!.toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });

  it("has no time window for per-run budgets", () => {
    expect(windowStart("run", new Date(), "UTC")).toBeNull();
  });
});
