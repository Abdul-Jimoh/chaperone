import type { JWK } from "jose";
import type { Db } from "@/db/client";
import { confirmDemoMandate, exampleReadBack, type DemoWorld } from "@/lib/app/demo";

export const DRAFT_SECRET = "test-draft-secret";

/** Confirms the example read-back, as a visitor pressing "Confirm and sign" without editing the sentence. */
export function confirmExample(db: Db, world: DemoWorld, userId: string, signingJwk: JWK) {
  return confirmDemoMandate(db, userId, exampleReadBack(world, userId, DRAFT_SECRET).token, { draft: DRAFT_SECRET, signingJwk });
}
