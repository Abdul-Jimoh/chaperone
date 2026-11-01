import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("env", () => {
  it("names a bad variable without echoing its value", async () => {
    vi.stubEnv("PAYPAL_ENV", "live-secret-looking-value");
    const { env, ConfigError } = await import("@/lib/env");
    expect(() => env()).toThrow(ConfigError);
    expect(() => env()).toThrow("Invalid env vars: PAYPAL_ENV");
    expect(() => env()).not.toThrow(/live-secret-looking-value/);
  });

  it("names a missing required variable", async () => {
    vi.stubEnv("APPROVAL_LINK_SECRET", "");
    const { requireEnv } = await import("@/lib/env");
    expect(() => requireEnv("APPROVAL_LINK_SECRET")).toThrow("Missing env var APPROVAL_LINK_SECRET");
  });
});
