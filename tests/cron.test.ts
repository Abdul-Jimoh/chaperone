import { describe, expect, it } from "vitest";
import { isCronRequest } from "@/lib/cron";

const secret = "cron-secret-for-tests-0123456789abcdef";
const req = (authorization?: string) =>
  new Request("https://chaperone.test/api/cron/sweep", authorization ? { headers: { authorization } } : {});

describe("cron auth", () => {
  it("accepts only Vercel's Bearer secret", () => {
    expect(isCronRequest(req(`Bearer ${secret}`), secret)).toBe(true);
    expect(isCronRequest(req(), secret)).toBe(false);
    expect(isCronRequest(req(secret), secret)).toBe(false);
    expect(isCronRequest(req(`Bearer ${secret}x`), secret)).toBe(false);
    expect(isCronRequest(req("Bearer "), "")).toBe(false);
  });
});
