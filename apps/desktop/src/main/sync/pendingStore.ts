import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type createDeviceIdentity,
  decodeBase64,
  decodeKeyPackageBytes,
  encodeBase64,
  encodeKeyPackageBytes,
} from "@suite/sync";

/**
 * The identity a device made in order to ask to join, kept until somebody answers.
 *
 * An invitation is spent the moment the host stores the key package, so the identity behind
 * that key package is the only thing that can open the welcome that comes back. Held in a
 * variable it lasted until the app closed, which is a promise that ends when a window does:
 * quit here and the invitation is gone while the other person adds a device that will never
 * appear. So it goes on disk, keyed by workspace, and the join resumes on launch.
 */
type PendingIdentity = Awaited<ReturnType<typeof createDeviceIdentity>>;

interface StoredPending {
  readonly version: 1;
  readonly name: string;
  readonly keyPackage: string;
  /** The host this device asked, so the wait can pick up where it left off. */
  readonly host: string;
  readonly private: {
    readonly initPrivateKey: string;
    readonly hpkePrivateKey: string;
    readonly signaturePrivateKey: string;
  };
}

/** A join that has not finished yet: what to open the welcome with, and where to wait. */
export interface PendingJoin {
  readonly identity: PendingIdentity;
  readonly host: string;
}

export async function savePending(
  dataDir: string,
  workspaceId: string,
  identity: PendingIdentity,
  host: string,
): Promise<void> {
  const directory = directoryFor(dataDir);
  await mkdir(directory, { recursive: true });

  const stored: StoredPending = {
    version: 1,
    name: identity.name,
    keyPackage: encodeBase64(encodeKeyPackageBytes(identity.keyPackage)),
    host,
    private: {
      initPrivateKey: encodeBase64(identity.privateKeys.initPrivateKey),
      hpkePrivateKey: encodeBase64(identity.privateKeys.hpkePrivateKey),
      signaturePrivateKey: encodeBase64(identity.privateKeys.signaturePrivateKey),
    },
  };

  // Written through a temporary file: half a key package is not a key package, and a crash
  // should leave the previous attempt intact rather than a file nothing can read.
  const target = pathFor(dataDir, workspaceId);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

export async function loadPending(
  dataDir: string,
  workspaceId: string,
): Promise<PendingJoin | null> {
  let parsed: StoredPending;
  try {
    parsed = JSON.parse(await readFile(pathFor(dataDir, workspaceId), "utf8")) as StoredPending;
  } catch {
    return null;
  }

  const initPrivateKey = decodeBase64(parsed.private?.initPrivateKey ?? "");
  const hpkePrivateKey = decodeBase64(parsed.private?.hpkePrivateKey ?? "");
  const signaturePrivateKey = decodeBase64(parsed.private?.signaturePrivateKey ?? "");
  if (initPrivateKey === null || hpkePrivateKey === null || signaturePrivateKey === null) {
    return null;
  }
  if (typeof parsed.host !== "string" || parsed.host.length === 0) return null;

  try {
    return {
      host: parsed.host,
      identity: {
        name: parsed.name,
        keyPackage: decodeKeyPackageBytes(new Uint8Array(Buffer.from(parsed.keyPackage, "base64"))),
        privateKeys: { initPrivateKey, hpkePrivateKey, signaturePrivateKey },
      },
    };
  } catch {
    // A file from an older protocol, or a damaged one, is not a reason to refuse to start.
    return null;
  }
}

/** The welcome arrived, or the attempt is over. Either way there is nothing left to hold. */
export async function clearPending(dataDir: string, workspaceId: string): Promise<void> {
  await rm(pathFor(dataDir, workspaceId), { force: true });
}

function directoryFor(dataDir: string): string {
  return join(dataDir, "sync", "pending");
}

function pathFor(dataDir: string, workspaceId: string): string {
  return join(directoryFor(dataDir), `${workspaceId}.json`);
}
