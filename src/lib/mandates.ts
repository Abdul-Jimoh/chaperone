import { randomUUID } from "node:crypto";
import type { JWK } from "jose";
import type { Db } from "@/db/client";
import { mandates, merchants } from "@/db/schema";
import { signMandate } from "@/lib/policy/mandate";
import { policySchema, type Policy } from "@/lib/policy/schema";

export type Mandate = typeof mandates.$inferSelect;

/**
 * The last step after the user has read the read-back and confirmed: sign the exact policy they saw
 * and store it with its hash. Nothing upstream of this (and no LLM) can make a mandate active.
 */
export async function storeConfirmedMandate(
  db: Db,
  input: { userId: string; statement: string; policy: Policy; signingJwk: JWK; now?: Date },
): Promise<Mandate> {
  const policy = policySchema.parse(input.policy);
  const issuedAt = (input.now ?? new Date()).toISOString();
  const id = randomUUID();
  const { jws, hash } = await signMandate(
    { mandateId: id, subject: input.userId, statement: input.statement, policy, issuedAt },
    input.signingJwk,
  );
  return db.transaction(async (tx) => {
    for (const m of policy.merchants) {
      await tx.insert(merchants).values({ paypalMerchantId: m.merchantId, name: m.name }).onConflictDoNothing();
    }
    const [mandate] = await tx
      .insert(mandates)
      .values({ id, userId: input.userId, statement: input.statement, policy, hash, jws, issuedAt: new Date(issuedAt) })
      .returning();
    return mandate!;
  });
}
