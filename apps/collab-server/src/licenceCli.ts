/**
 * Operator tool for hosted-sync licences.
 *
 *   pnpm --filter @suite/collab-server licence generate-keypair [--out ./licence-private.pem]
 *   pnpm --filter @suite/collab-server licence sign --key ./licence-private.pem \
 *     --tier hosted --workspaces 25 --document-bytes 5242880 \
 *     --attachment-bytes 26214400 --days 365 [--email ops@example.com] [--id acme-2026]
 *
 * The private key is written once, with mode 0600, and is never printed. Only
 * the public key is; paste it into the relay as `SUITE_LICENCE_PUBLIC_KEY`.
 * `sign` prints the token on one line of stdout, and that line is
 * `SUITE_LICENCE` on the relay the licence is for (ADR-0081). The relay verifies
 * it at boot and refuses to start when it does not verify, so a token minted
 * here is either accepted whole or reported by name.
 */

import { createPublicKey, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LICENCE_FORMAT_VERSION, type LicenceClaims, signLicence } from "@suite/licence";

const DEFAULT_KEY_FILE = "licence-private.pem";

interface ParsedArgs {
  command: string;
  flags: Map<string, string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === undefined) continue;
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const equals = argument.indexOf("=");
    if (equals !== -1) {
      flags.set(argument.slice(2, equals), argument.slice(equals + 1));
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    flags.set(argument.slice(2), value);
    index += 1;
  }
  return { command, flags };
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function integer(flags: Map<string, string>, name: string, min: number): number {
  const raw = required(flags, name);
  if (!/^\d+$/.test(raw)) throw new Error(`--${name} must be a whole number`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`--${name} must be at least ${min}`);
  }
  return value;
}

/** Raw 32-byte Ed25519 public key, so the env value is a single line. */
function publicKeyBase64(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  // Drop the fixed 12-byte SPKI header, leaving the raw key.
  return Buffer.from(der).subarray(12).toString("base64");
}

function generateKeypair(flags: Map<string, string>): number {
  const target = resolve(flags.get("out")?.trim() || DEFAULT_KEY_FILE);
  if (existsSync(target)) {
    console.error(`Refusing to overwrite ${target}. Move it aside or pass --out.`);
    return 1;
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  writeFileSync(target, privatePem, { mode: 0o600, flag: "wx" });
  chmodSync(target, 0o600);

  console.error(
    `Wrote the private key to ${target} (mode 0600). Keep it offline and never commit it.`,
  );
  console.error("Set this on the relay as SUITE_LICENCE_PUBLIC_KEY:");
  console.log(publicKeyBase64(publicKey.export({ type: "spki", format: "pem" }).toString()));
  return 0;
}

function sign(flags: Map<string, string>): number {
  const keyPath = resolve(flags.get("key")?.trim() || "");
  if (!flags.get("key")?.trim()) {
    throw new Error("--key <private key file> is required; run generate-keypair first");
  }
  if (!existsSync(keyPath)) {
    throw new Error(`No private key file at ${keyPath}; run generate-keypair first`);
  }

  const issuedAt = Date.now();
  const days = integer(flags, "days", 1);
  const claims: LicenceClaims = {
    v: LICENCE_FORMAT_VERSION,
    id: flags.get("id")?.trim() || randomUUID(),
    tier: required(flags, "tier"),
    workspaces: integer(flags, "workspaces", 1),
    documentBytes: integer(flags, "document-bytes", 0),
    attachmentBytes: integer(flags, "attachment-bytes", 0),
    issuedAt,
    expiresAt: issuedAt + days * 24 * 60 * 60 * 1000,
  };
  const email = flags.get("email")?.trim();
  if (email) claims.email = email;

  const privatePem = readFileSync(keyPath, "utf8");
  const token = signLicence(claims, privatePem);

  // Self-check with the paired public key, so a broken build never ships a token.
  const publicPem = createPublicKey(privatePem).export({ type: "spki", format: "pem" }).toString();
  const [payload, signature] = token.split(".");
  const good =
    payload !== undefined &&
    signature !== undefined &&
    verify(
      null,
      Buffer.from(payload, "base64url"),
      createPublicKey(publicPem),
      Buffer.from(signature, "base64url"),
    );
  if (!good) throw new Error("The freshly signed token did not verify; check the key file");

  console.error(
    `Signed ${claims.tier} licence ${claims.id} for ${claims.workspaces} workspaces, valid ${days} days.`,
  );
  console.error(
    "Set the line below as SUITE_LICENCE on the relay, and set SUITE_LICENCE_PUBLIC_KEY there to the public half of this key.",
  );
  console.log(token);
  return 0;
}

function usage(): void {
  console.error(`Usage:
  licence generate-keypair [--out ${DEFAULT_KEY_FILE}]
  licence sign --key <private key file> --tier <name> --workspaces <n>
               --document-bytes <n> --attachment-bytes <n> --days <n>
               [--email <address>] [--id <identifier>]

The private key never leaves its file and is never printed. generate-keypair
prints the public key for SUITE_LICENCE_PUBLIC_KEY; sign prints the licence token
for SUITE_LICENCE on the relay that verifies with that key. The token is one
line: copy it whole, with no line breaks.`);
}

function main(argv: readonly string[]): number {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    return 1;
  }

  try {
    switch (parsed.command) {
      case "generate-keypair":
        return generateKeypair(parsed.flags);
      case "sign":
        return sign(parsed.flags);
      case "help":
      case "--help":
      case "-h":
        usage();
        return 0;
      default:
        console.error(`Unknown command: ${parsed.command}`);
        usage();
        return 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
