import { exportJWK, generateKeyPair, type JWK } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { merchants, users } from "@/db/schema";
import { storeConfirmedMandate } from "@/lib/mandates";
import { canonicalJson } from "@/lib/policy/canonical";
import { describePolicy } from "@/lib/policy/describe";
import { mandateHash, publicJwkOf, signMandate, verifyMandate, type MandateBody } from "@/lib/policy/mandate";
import { policySchema } from "@/lib/policy/schema";
import { resetDb, testDb } from "./support/db";
import { samplePolicy } from "./support/fixtures";

let privateJwk: JWK;
const body: MandateBody = {
  mandateId: "7b0c1c9e-3c1b-4a5e-9f43-0a4f6f1f2a10",
  subject: "user-1",
  statement: "Restock coffee and dog food every two weeks. Max $80 per run, $150 a month.",
  policy: samplePolicy(),
  issuedAt: "2026-11-01T10:00:00Z",
};

beforeAll(async () => {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  privateJwk = await exportJWK(privateKey);
});

describe("canonicalJson", () => {
  it("ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe('{"a":{"d":[1,{"x":1,"y":2}]},"b":1}');
  });
});

describe("mandate JWS", () => {
  it("round-trips and reproduces the hash", async () => {
    const { jws, hash } = await signMandate(body, privateJwk);
    const verified = await verifyMandate(jws, publicJwkOf(privateJwk));
    expect(verified.hash).toBe(hash);
    expect(verified.body).toEqual(body);
  });

  it("changes the hash when any policy value changes", () => {
    const other = { ...body, policy: samplePolicy({ perTransactionCapCents: 8_001 }) };
    expect(mandateHash(other)).not.toBe(mandateHash(body));
  });

  it("rejects a tampered payload", async () => {
    const { jws } = await signMandate(body, privateJwk);
    const [h, p, s] = jws.split(".");
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    payload.mandate.policy.perTransactionCapCents = 999_999;
    const forged = [h, Buffer.from(JSON.stringify(payload)).toString("base64url"), s].join(".");
    await expect(verifyMandate(forged, publicJwkOf(privateJwk))).rejects.toThrow();
  });

  it("rejects a signature from another key", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const { jws } = await signMandate(body, await exportJWK(privateKey));
    await expect(verifyMandate(jws, publicJwkOf(privateJwk))).rejects.toThrow();
  });

  it("expires with the policy", async () => {
    const expiring = { ...body, policy: samplePolicy({ expiresAt: "2026-12-01T00:00:00Z" }) };
    const { jws } = await signMandate(expiring, privateJwk);
    await expect(verifyMandate(jws, publicJwkOf(privateJwk), { currentDate: new Date("2026-11-15T00:00:00Z") })).resolves.toBeTruthy();
    await expect(verifyMandate(jws, publicJwkOf(privateJwk), { currentDate: new Date("2026-12-02T00:00:00Z") })).rejects.toThrow();
  });
});

describe("policy schema and read-back", () => {
  it("accepts the sample and reads it back in plain language", () => {
    const policy = policySchema.parse(samplePolicy());
    expect(describePolicy(policy)).toEqual([
      "Only buy: coffee, dog-food",
      "Only pay these shops: Bean Supply Co, Pet Pantry",
      "Max $80.00 per purchase",
      "Spend at most $80.00 per shopping run",
      "Spend at most $150.00 per month",
      "At most 4 of any one item",
      "Ask me before anything over $40.00",
      "Shop every 2 weeks",
      "Valid until you revoke it",
    ]);
  });

  it("rejects unknown fields, duplicate budgets, bad merchant ids and absurd caps", () => {
    expect(policySchema.safeParse({ ...samplePolicy(), note: "ignore limits" }).success).toBe(false);
    expect(policySchema.safeParse(samplePolicy({ budgets: [{ period: "month", limitCents: 1 }, { period: "month", limitCents: 2 }] })).success).toBe(false);
    expect(policySchema.safeParse(samplePolicy({ merchants: [{ merchantId: "evil.example.com", name: "x" }] })).success).toBe(false);
    expect(policySchema.safeParse(samplePolicy({ perTransactionCapCents: 100_000_000 })).success).toBe(false);
    expect(policySchema.safeParse(samplePolicy({ timezone: "Mars/Olympus" })).success).toBe(false);
  });
});

describe("storeConfirmedMandate", () => {
  const { db, pool } = testDb(5);
  afterAll(() => pool.end());
  beforeEach(() => resetDb(db));

  it("stores a mandate whose JWS verifies and whose hash every payment will record", async () => {
    const [user] = await db.insert(users).values({ displayName: "Test" }).returning();
    const mandate = await storeConfirmedMandate(db, {
      userId: user!.id,
      statement: body.statement,
      policy: samplePolicy(),
      signingJwk: privateJwk,
    });
    const verified = await verifyMandate(mandate.jws, publicJwkOf(privateJwk));
    expect(verified.hash).toBe(mandate.hash);
    expect(verified.body).toMatchObject({ mandateId: mandate.id, subject: user!.id, policy: samplePolicy() });
    expect(await db.select().from(merchants)).toHaveLength(2);
  });
});
