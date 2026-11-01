import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentKeys } from "@/db/schema";
import { sha256Hex } from "@/lib/policy/canonical";

const PREFIX = "chp_ak_";

/** Shown once. Only the hash is stored, so the database can't leak usable keys. */
export async function issueAgentKey(db: Db, mandateId: string, label: string): Promise<string> {
  const key = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  await db.insert(agentKeys).values({ mandateId, label, keyHash: sha256Hex(key) });
  return key;
}

/** The mandate a key pays under, or null. A revoked mandate still resolves, so its requests are denied on the record. */
export async function resolveAgentKey(db: Db, key: string, now = new Date()): Promise<{ keyId: string; mandateId: string } | null> {
  if (!key.startsWith(PREFIX)) return null;
  const [row] = await db
    .update(agentKeys)
    .set({ lastUsedAt: now })
    .where(and(eq(agentKeys.keyHash, sha256Hex(key)), isNull(agentKeys.revokedAt)))
    .returning({ keyId: agentKeys.id, mandateId: agentKeys.mandateId });
  return row ?? null;
}
