import { sql } from "drizzle-orm";
import { inject } from "vitest";
import { createDb, type Db } from "@/db/client";
import { mandates, paymentMethods, users } from "@/db/schema";
import type { Policy } from "@/lib/policy/schema";

export function testDb(max = 20) {
  return createDb(inject("databaseUrl"), { max });
}

export async function resetDb(db: Db) {
  await db.execute(sql`
    truncate table agent_keys, ledger_events, approvals, reservations, payments, mandates, payment_methods,
      merchants, webhook_events, llm_usage, users restart identity cascade
  `);
}

/** A mandate whose user has linked a PayPal wallet, so holds can be placed. */
export async function seedLinkedMandate(db: Db, policy: Policy) {
  const mandate = await seedMandate(db, policy);
  await db.insert(paymentMethods).values({ userId: mandate.userId, paypalPaymentTokenId: "VAULT-TEST-1" });
  return mandate;
}

export async function seedMandate(db: Db, policy: Policy, status: "active" | "revoked" = "active") {
  const [user] = await db.insert(users).values({ displayName: "Test User" }).returning();
  const [mandate] = await db
    .insert(mandates)
    .values({
      userId: user!.id,
      statement: "test mandate",
      policy,
      hash: "test-hash",
      jws: "test-jws",
      status,
      issuedAt: new Date(),
    })
    .returning();
  return mandate!;
}
