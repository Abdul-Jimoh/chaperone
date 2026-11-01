import { calculateJwkThumbprint, importJWK, jwtVerify, SignJWT, type JWK } from "jose";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "./canonical";
import { policySchema, type Policy } from "./schema";

export const MANDATE_JWT_TYPE = "mandate+jwt";
const ISSUER = "chaperone";

export type MandateBody = {
  mandateId: string;
  subject: string;
  /** The user's own words, kept alongside the compiled policy they confirmed. */
  statement: string;
  policy: Policy;
  issuedAt: string;
};

const bodySchema = z.strictObject({
  mandateId: z.string().min(1),
  subject: z.string().min(1),
  statement: z.string().min(1).max(2000),
  policy: policySchema,
  issuedAt: z.iso.datetime({ offset: true }),
});

/** The hash every ledger row records: what exactly was this payment checked against. */
export function mandateHash(body: MandateBody): string {
  return sha256Hex(canonicalJson(bodySchema.parse(body)));
}

export async function signMandate(body: MandateBody, privateJwk: JWK): Promise<{ jws: string; hash: string }> {
  const parsed = bodySchema.parse(body);
  const hash = mandateHash(parsed);
  const key = await importJWK(privateJwk, "ES256");
  const kid = privateJwk.kid ?? (await calculateJwkThumbprint(privateJwk));
  const builder = new SignJWT({ mandate: parsed, mandate_hash: hash })
    .setProtectedHeader({ alg: "ES256", typ: MANDATE_JWT_TYPE, kid })
    .setIssuer(ISSUER)
    .setSubject(parsed.subject)
    .setJti(parsed.mandateId)
    .setIssuedAt(new Date(parsed.issuedAt));
  if (parsed.policy.expiresAt) builder.setExpirationTime(new Date(parsed.policy.expiresAt));
  return { jws: await builder.sign(key), hash };
}

export class MandateVerificationError extends Error {}

export async function verifyMandate(
  jws: string,
  publicJwk: JWK,
  options: { currentDate?: Date } = {},
): Promise<{ body: MandateBody; hash: string }> {
  const key = await importJWK(publicJwk, "ES256");
  const { payload } = await jwtVerify(jws, key, {
    issuer: ISSUER,
    typ: MANDATE_JWT_TYPE,
    algorithms: ["ES256"],
    currentDate: options.currentDate,
  });
  const body = bodySchema.safeParse(payload.mandate);
  if (!body.success) throw new MandateVerificationError("mandate claim is malformed");
  const hash = mandateHash(body.data);
  if (payload.mandate_hash !== hash) throw new MandateVerificationError("mandate hash mismatch");
  if (payload.jti !== body.data.mandateId || payload.sub !== body.data.subject) {
    throw new MandateVerificationError("registered claims disagree with the mandate body");
  }
  return { body: body.data, hash };
}

export function publicJwkOf(privateJwk: JWK): JWK {
  const { kty, crv, x, y, kid, alg } = privateJwk;
  return { kty, crv, x, y, kid, alg };
}
