import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Secrets at rest, with the key the deployment holds.
 *
 * A Stripe secret key and an SMTP password have to survive a restart, and they must not be
 * readable by anything that can read the table: a database dump, a backup, a screenshot of
 * a psql session. So the row holds ciphertext, the key lives in `SUITE_SETTINGS_KEY`, and
 * the API returns a mask instead of a value. The key itself cannot live in the table, which
 * is why it is on the bootstrap list.
 *
 * AES-256-GCM, with the key derived once from the deployment's secret and a tag per value.
 * A wrong key fails closed: decryption throws rather than returning the ciphertext.
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

const derived = new Map<string, Buffer>();

function keyFrom(secret: string): Buffer {
  // A fixed salt is right here: the secret is per deployment, and rotating it re-encrypts
  // everything anyway. A random salt would have to be stored beside each value for no gain.
  //
  // scrypt is deliberately slow, and the overlay decrypts on every read that composes an
  // environment, so the derived key is kept for the life of the process. There is one
  // deployment secret, so the map holds one entry; a rotated secret adds a second and the
  // old one is dropped rather than kept forever.
  const cached = derived.get(secret);
  if (cached !== undefined) return cached;
  const key = scryptSync(secret, "suite.settings.v1", 32);
  if (derived.size >= 4) derived.clear();
  derived.set(secret, key);
  return key;
}

/** Encrypts one value into the `v1.iv.tag.body` form the column stores. */
export function encryptSetting(secret: string, plaintext: string): string {
  if (secret.trim().length < 16) {
    throw new Error("SUITE_SETTINGS_KEY must be at least 16 characters to encrypt a secret");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

/**
 * Decrypts one stored value.
 *
 * Throws on a wrong key or a tampered value rather than returning something plausible: a
 * feature that asked for a secret and got the ciphertext back would send it to Stripe and
 * fail in a way nobody can read.
 */
export function decryptSetting(secret: string, stored: string): string {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) {
    throw new Error("a stored setting is not in the expected v1 form");
  }
  const decipher = createDecipheriv(ALGORITHM, keyFrom(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Whether a stored value looks encrypted, so a migration can tell rows apart. */
export function isEncryptedSetting(value: string): boolean {
  return value.startsWith("v1.") && value.split(".").length === 4;
}

/** What a secret reads as when the API is asked for it: never the value itself. */
export const SECRET_MASK = "••••••••";
