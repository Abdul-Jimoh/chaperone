#!/usr/bin/env node
// Prints an ES256 private JWK for MANDATE_SIGNING_JWK. Keep the output out of the repo.
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = await exportJWK(privateKey);
jwk.kid = await calculateJwkThumbprint(jwk);
jwk.alg = "ES256";
console.log(JSON.stringify(jwk));
