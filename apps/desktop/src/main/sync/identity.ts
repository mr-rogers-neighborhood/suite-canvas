import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Who this install is, as far as the host and its neighbours are concerned.
 *
 * One Ed25519 key per app install, in the app's own data directory. It signs every frame
 * this device sends, and its fingerprint is the device id. The host pins the key on first
 * join and refuses any later frame that does not carry it, so losing this file means
 * asking to be let back in, not silently becoming someone else.
 *
 * This is deliberately not the key inside the MLS credential. That one belongs to the
 * group; this one belongs to the installation, and it is what still works when a device
 * has been removed from every group it was in.
 */
const IDENTITY_FILE = "identity.json";

export interface DeviceIdentity {
  /** Base64 of 32 raw Ed25519 bytes. */
  readonly publicKey: string;
  readonly deviceId: string;
  sign(payload: Uint8Array | string): string;
}

interface StoredIdentity {
  readonly version: 1;
  readonly publicKey: string;
  readonly privateKey: string;
}

export async function loadOrCreateIdentity(dataDir: string): Promise<DeviceIdentity> {
  const path = join(dataDir, "sync", IDENTITY_FILE);
  const stored = await read(path);
  if (stored !== null) return fromStored(stored);

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // 12 bytes of SPKI header, then the 32 raw bytes every other implementation wants.
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const created: StoredIdentity = {
    version: 1,
    publicKey: rawPublic.toString("base64"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };

  await mkdir(join(dataDir, "sync"), { recursive: true });
  await writeFile(path, `${JSON.stringify(created, null, 2)}\n`, { mode: 0o600 });
  return fromStored(created);
}

/** The id the protocol expects: the SHA-256 of the raw public key, lower-case hex. */
export function deviceIdFrom(publicKeyBase64: string): string {
  return createHash("sha256").update(Buffer.from(publicKeyBase64, "base64")).digest("hex");
}

function fromStored(stored: StoredIdentity): DeviceIdentity {
  const key = createPrivateKey({
    key: Buffer.from(stored.privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return {
    publicKey: stored.publicKey,
    deviceId: deviceIdFrom(stored.publicKey),
    sign: (payload) => sign(null, Buffer.from(payload), key).toString("base64"),
  };
}

async function read(path: string): Promise<StoredIdentity | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as StoredIdentity;
    if (typeof parsed.publicKey !== "string" || typeof parsed.privateKey !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
