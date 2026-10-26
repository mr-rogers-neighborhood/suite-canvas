/**
 * Operator dry run: sign a licence and print the email, without Stripe and
 * without sending anything.
 *
 *   node dev.ts --dry-run --email ops@example.com --price price_123 --days 30
 *   node dev.ts --dry-run --email ops@example.com --tier hosted --workspaces 10 \
 *     --document-bytes 268435456 --attachment-bytes 1073741824
 *
 * This is also the manual-issuance path for someone who emails support: the
 * token printed on stdout is a real, verifiable licence, signed with the same
 * key and the same payload as a purchase. Store it against the customer, or
 * re-run with the same email to issue a fresh one (the licence id is derived
 * from the address, so support and the relay see one customer, not two).
 *
 * The private key comes from `--key <file>` or `SUITE_LICENCE_PRIVATE_KEY`.
 */

import { createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { environment } from "../handler/handler.ts";
import { memoryStore } from "../store/store.ts";
import { issueManual } from "../stripe/issue.ts";
import { parseTierTable, type TierPlan } from "../stripe/tiers.ts";

export interface DevIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const DEFAULT_IO: DevIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

function usage(): string {
  return `Usage:
  node dev.ts --dry-run --email <address> (--price <price id> | --tier <name>)
               [--workspaces <n>] [--document-bytes <n>] [--attachment-bytes <n>]
               [--days <n>] [--key <private key file>] [--self-host-url <url>]

  --dry-run      required; this script never talks to Stripe and never sends mail
  --price        a price id from STRIPE_PRICE_TIERS
  --tier         or name a tier directly, with its quotas
  --days         days of licence from now (default 30)
  --key          private key file; otherwise SUITE_LICENCE_PRIVATE_KEY

The token goes to stdout; the email it would have sent goes to stderr.`;
}

interface ParsedArgs {
  flags: Map<string, string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    if (argument === "--dry-run") {
      flags.set("dry-run", "1");
      continue;
    }
    const equals = argument.indexOf("=");
    if (equals !== -1) {
      flags.set(argument.slice(2, equals), argument.slice(equals + 1));
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    flags.set(argument.slice(2), value);
    index += 1;
  }
  return { flags };
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function integer(flags: Map<string, string>, name: string, fallback: number, min: number): number {
  const raw = flags.get(name)?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`--${name} must be a whole number`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`--${name} must be at least ${min}`);
  }
  return value;
}

function planFromFlags(flags: Map<string, string>): TierPlan | null {
  const tier = flags.get("tier")?.trim();
  if (!tier) return null;
  return {
    tier,
    workspaces: integer(flags, "workspaces", 25, 1),
    documentBytes: integer(flags, "document-bytes", 268_435_456, 0),
    attachmentBytes: integer(flags, "attachment-bytes", 1_073_741_824, 0),
  };
}

function privateKeyFrom(flags: Map<string, string>, envKey: string | undefined): string {
  const path = flags.get("key")?.trim();
  if (path) {
    const resolved = resolve(path);
    if (!existsSync(resolved)) throw new Error(`No private key file at ${resolved}`);
    return readFileSync(resolved, "utf8");
  }
  const inline = envKey?.trim();
  if (!inline) {
    throw new Error(
      "No private key: pass --key <file> or set SUITE_LICENCE_PRIVATE_KEY. " +
        'Generate one with "pnpm --filter @suite/collab-server licence generate-keypair".',
    );
  }
  return inline.includes("\\n") ? inline.replaceAll("\\n", "\n") : inline;
}

/** Signs and immediately verifies, so a broken key never prints a token. */
function selfCheck(token: string, privateKeyPem: string): void {
  const [payload, signature] = token.split(".");
  if (payload === undefined || signature === undefined) {
    throw new Error("The signed token is malformed");
  }
  const publicPem = createPublicKey(privateKeyPem)
    .export({ type: "spki", format: "pem" })
    .toString();
  const good = verify(
    null,
    Buffer.from(payload, "base64url"),
    createPublicKey(publicPem),
    Buffer.from(signature, "base64url"),
  );
  if (!good) throw new Error("The freshly signed token did not verify; check the key");
}

export async function main(
  argv: readonly string[],
  source: Record<string, string | undefined> = process.env,
  io: DevIo = DEFAULT_IO,
  now: () => number = Date.now,
): Promise<number> {
  const env = environment(source);
  let flags: Map<string, string>;
  try {
    flags = parseArgs(argv).flags;
  } catch (error) {
    io.err(messageOf(error));
    io.err(usage());
    return 1;
  }

  if (!flags.has("dry-run")) {
    io.err("dev.ts only runs in dry-run mode; pass --dry-run.");
    io.err(usage());
    return 1;
  }

  try {
    const email = required(flags, "email");
    const keyPem = privateKeyFrom(flags, env.SUITE_LICENCE_PRIVATE_KEY);
    const directPlan = planFromFlags(flags);
    const priceId = flags.get("price")?.trim() ?? directPlan?.tier ?? "";

    const tiers = new Map<string, TierPlan>();
    if (priceId.length === 0) {
      throw new Error("Pass --price <price id> or --tier <name>");
    }
    if (directPlan !== null) {
      tiers.set(priceId, directPlan);
    } else {
      const configured = parseTierTable(env.STRIPE_PRICE_TIERS);
      if (configured.isErr()) throw configured.error;
      for (const [id, plan] of configured.value) tiers.set(id, plan);
    }

    const days = integer(flags, "days", 30, 1);
    const selfHostUrl =
      flags.get("self-host-url")?.trim() ||
      env.SUITE_SELF_HOST_URL?.trim() ||
      "https://github.com/mr-rogers-neighborhood/suite-canvas#deployment";

    const sent: string[] = [];
    const outcome = await issueManual(
      {
        store: memoryStore(),
        tiers,
        emailer: {
          async send(message) {
            sent.push(message.text);
          },
        },
        privateKeyPem: keyPem,
        selfHostUrl,
        now,
      },
      { email, priceId, days },
    );

    if (outcome.status === "ignored" || outcome.status === "unchanged") {
      throw new Error(`Nothing to issue: ${outcome.status}`);
    }
    selfCheck(outcome.token, keyPem);

    const body = sent[0];
    if (body === undefined) throw new Error("the emailer recorded no message");

    io.err(
      `dry run: issued ${outcome.record.tier} licence ${outcome.record.licenceId} to ${email}, ` +
        `valid until ${new Date(outcome.record.expiresAt).toISOString()} (${days} days, nothing sent)`,
    );
    io.err("--- email ---");
    io.err(body);
    io.err("--- end email ---");
    io.out(outcome.token);
    return 0;
  } catch (error) {
    io.err(messageOf(error));
    return 1;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
