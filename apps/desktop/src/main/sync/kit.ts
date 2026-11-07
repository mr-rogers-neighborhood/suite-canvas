import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { type DeviceGroup, decodeGroup, encodeGroup } from "@suite/sync";
import type { StoredIdentityFile } from "./identity.js";

/**
 * A way back in, as one file.
 *
 * MLS has no escrow and a blind hub has nothing to restore from, so this is the only thing
 * that survives losing every device in a workspace. It carries the two halves that make a
 * device real: its signing identity, which the hub has pinned and will not accept a substitute
 * for, and the group state, which is the only thing that can read what was sealed to it.
 *
 * Whoever holds the file *is* this device — that is what makes it a recovery rather than a
 * backup — so the only question is how it is protected. Plain by default, because a person
 * keeping it somewhere they already trust is the common case and a forgotten passphrase is a
 * third way to lose a workspace. A passphrase is offered for the case where the file will
 * travel somewhere less trusted.
 */
export const KIT_FORMAT = "suite.recovery-kit";
export const KIT_VERSION = 1;

export interface KitPayload {
  readonly group: string;
  readonly identity: StoredIdentityFile;
}

export interface KitFile {
  readonly format: typeof KIT_FORMAT;
  readonly version: number;
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly createdAt: string;
  /** Present when the kit is not sealed. */
  readonly plain?: KitPayload;
  /** Present when it is. The payload is inside, and the passphrase is not written down. */
  readonly sealed?: {
    readonly salt: string;
    readonly nonce: string;
    readonly tag: string;
    readonly ciphertext: string;
  };
}

export interface KitOptions {
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly group: DeviceGroup;
  readonly identity: StoredIdentityFile;
  readonly now?: Date;
}

const SCRYPT_KEY_LENGTH = 32;
const NONCE_BYTES = 12;

/** Write a kit. `passphrase` seals it; null or "" leaves it plain. */
export function exportKit(options: KitOptions, passphrase: string | null): Uint8Array {
  const payload: KitPayload = {
    group: Buffer.from(encodeGroup(options.group)).toString("base64"),
    identity: options.identity,
  };
  const common = {
    format: KIT_FORMAT as typeof KIT_FORMAT,
    version: KIT_VERSION,
    workspaceId: options.workspaceId,
    deviceId: options.deviceId,
    deviceName: options.deviceName,
    createdAt: (options.now ?? new Date()).toISOString(),
  };

  const secret = passphrase?.trim() ?? "";
  if (secret.length === 0) {
    return encodeJson({ ...common, plain: payload });
  }

  const salt = randomBytes(16);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, salt), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
    cipher.final(),
  ]);

  return encodeJson({
    ...common,
    sealed: {
      salt: salt.toString("base64"),
      nonce: nonce.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    },
  });
}

export interface OpenedKit {
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly group: DeviceGroup;
  readonly identity: StoredIdentityFile;
}

/**
 * Read a kit, or say what is wrong with it in a sentence a person can act on.
 *
 * A wrong passphrase and a damaged file are the same failure to a cipher; they are different
 * failures to a person, so the message names the passphrase when one was supplied.
 */
export function importKit(bytes: Uint8Array, passphrase: string | null): OpenedKit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("That file is not a recovery file.");
  }
  const kit = parsed as Partial<KitFile>;
  if (kit.format !== KIT_FORMAT) throw new Error("That file is not a recovery file.");
  if (typeof kit.version !== "number" || kit.version > KIT_VERSION) {
    throw new Error("That recovery file was written by a newer version of the app.");
  }
  if (typeof kit.workspaceId !== "string" || typeof kit.deviceId !== "string") {
    throw new Error("That recovery file is missing what it needs.");
  }

  const payload = kit.sealed === undefined ? kit.plain : openSealed(kit.sealed, passphrase);
  if (payload === undefined) throw new Error("That recovery file has nothing in it.");

  const identity = payload.identity;
  if (typeof identity?.publicKey !== "string" || typeof identity?.privateKey !== "string") {
    throw new Error("That recovery file is missing the device it belongs to.");
  }

  let group: DeviceGroup;
  try {
    group = decodeGroup(new Uint8Array(Buffer.from(payload.group, "base64")));
  } catch {
    throw new Error("That recovery file's workspace could not be read.");
  }

  return {
    workspaceId: kit.workspaceId,
    deviceId: kit.deviceId,
    deviceName: typeof kit.deviceName === "string" ? kit.deviceName : "this device",
    group,
    identity,
  };
}

function openSealed(sealed: NonNullable<KitFile["sealed"]>, passphrase: string | null): KitPayload {
  const secret = passphrase?.trim() ?? "";
  if (secret.length === 0) throw new Error("That recovery file needs its passphrase.");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret, Buffer.from(sealed.salt, "base64")),
      Buffer.from(sealed.nonce, "base64"),
    );
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plain.toString("utf8")) as KitPayload;
  } catch {
    throw new Error("That passphrase did not open it.");
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  // scrypt with the library's own defaults for N: slow enough to be worth the name, fast
  // enough that opening a file once is not noticeable.
  return scryptSync(passphrase.normalize("NFKC"), salt, SCRYPT_KEY_LENGTH);
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}
