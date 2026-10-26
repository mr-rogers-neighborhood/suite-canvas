import { createPublicKey, type KeyObject } from "node:crypto";

/** DER prefix of an Ed25519 SubjectPublicKeyInfo; raw keys are 32 bytes. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Accepts either a PEM SPKI block or a bare base64/base64url raw Ed25519 key,
 * so the relay can be configured from a single environment line.
 */
export function parseLicencePublicKey(value: string): KeyObject | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    if (trimmed.includes("BEGIN")) return createPublicKey(trimmed);
    const raw = Buffer.from(trimmed.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (raw.length === 32) {
      return createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
        format: "der",
        type: "spki",
      });
    }
    return createPublicKey({ key: raw, format: "der", type: "spki" });
  } catch {
    return null;
  }
}
