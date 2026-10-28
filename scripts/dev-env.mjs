#!/usr/bin/env node
/**
 * Writes a `.env` a local run can actually boot with accounts on.
 *
 * `pnpm dev` starts three processes and none of them can talk to each other
 * without a handful of values that are easy to get subtly wrong: the two
 * services share one session secret, both must agree on the origin the browser
 * uses, and the database port is 5433 because `compose.dev.yaml` publishes it
 * there. Typing those by hand is how a session ends up signed for `:1236` and
 * verified for `:5173`, which fails as "no account can sync" rather than as a
 * configuration error.
 *
 * It never overwrites an existing `.env`: a file with real Stripe keys in it is
 * worth more than the convenience of regenerating. `--force` writes `.env.new`
 * beside it instead, so a diff is possible before anything is lost.
 *
 * Usage:
 *   node scripts/dev-env.mjs            write .env, or report that one exists
 *   node scripts/dev-env.mjs --force    write .env.new next to it
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, ".env");
const force = process.argv.includes("--force");

/** The origin the browser uses: the Vite dev server, which proxies the rest. */
const APP_ORIGIN = "http://localhost:5173";

/** `compose.dev.yaml` publishes Postgres here so host processes can reach it. */
const DATABASE_URL = "postgres://suite:suite@127.0.0.1:5433/suite";

/**
 * Values a dev run needs, replaced in the copied `.env.example`.
 *
 * Every one is commented out or off in the example, because the example
 * documents a deployment. A local run wants accounts on, so the pair is flipped
 * and the secrets filled.
 */
const OVERRIDES = {
  SUITE_AUTH_ENABLED: "1",
  SUITE_AUTH_SECRET: randomBytes(48).toString("base64url"),
  SUITE_AUTH_URL: APP_ORIGIN,
  SUITE_AUTH_DATABASE_URL: DATABASE_URL,
  SUITE_CONTROL_PLANE_DATABASE_URL: DATABASE_URL,
  // A second organization is what a billing test needs: an upgrade applies to an
  // organization, and being stuck in the first one makes the flow untestable.
  SUITE_AUTH_MAX_ORGS_PER_USER: "3",
  // No mailbox locally, and the console transport redacts the token it prints, so
  // a developer could never finish a sign-up. The reference states the risk.
  SUITE_AUTH_REQUIRE_VERIFICATION: "0",
  SUITE_AUTH_RP_ID: "localhost",
  SUITE_AUTH_RP_NAME: "Suite",
  // Billing stays off until a Stripe key exists. `pnpm stripe` prints the three
  // values that turn it on, and starting the control plane without them is a 503
  // on every billing route rather than a boot failure.
  SUITE_BILLING_ENABLED: "0",
  // The operator admission queue. Generated rather than left empty so a local run
  // can admit an account by hand and read the list back; `SUITE_ADMISSION_REQUIRED`
  // stays off, so nothing is held unless someone turns the queue on.
  SUITE_ADMIN_TOKEN: randomBytes(32).toString("base64url"),
  // The settings table encrypts every secret it holds. Generated here so the panel
  // can store a Stripe key on the first run; without it a secret write is refused
  // rather than stored in the clear.
  SUITE_SETTINGS_KEY: randomBytes(32).toString("base64url"),
  SUITE_APP_URL: APP_ORIGIN,
  SUITE_MAIL_TRANSPORT: "console",
  // The deployment's shape, locally: licences are enforced, so `pnpm drill:billing` can
  // walk trial, past due, active and cancelled without a payment provider.
  SUITE_HOSTED: "1",
  SUITE_LICENCE_PUBLIC_KEY: licencePublicKey(),
};

/**
 * The public half of an Ed25519 keypair, base64 raw.
 *
 * `SUITE_HOSTED=1` is what opens the relay's licence store, and the relay refuses to start
 * without a verification key. The pair proves nothing here — the hosted path reads capacity
 * from the organization's subscription, never from a signed self-host licence — but the
 * variable is required, and an unlicensed local run could not test the gate at all.
 */
function licencePublicKey() {
  const { publicKey } = generateKeyPairSync("ed25519");
  // The raw key is the last 32 bytes of the SPKI DER, which is what the relay expects.
  const der = publicKey.export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(der.length - 32)).toString("base64");
}

/** A commented `KEY=` line becomes a live one; a live line keeps its comment. */
function setValue(source, key, value) {
  const commented = new RegExp(`^# ${key}=.*$`, "mu");
  const live = new RegExp(`^${key}=.*$`, "mu");
  if (live.test(source)) return source.replace(live, `${key}=${value}`);
  if (commented.test(source)) return source.replace(commented, `${key}=${value}`);
  return `${source.trimEnd()}\n${key}=${value}\n`;
}

function main() {
  if (existsSync(target) && !force) {
    console.log(".env already exists; nothing written.");
    console.log("Run with --force to write .env.new beside it and diff the two.");
    return 0;
  }

  const example = readFileSync(join(root, ".env.example"), "utf8");
  let out = example;
  for (const [key, value] of Object.entries(OVERRIDES)) out = setValue(out, key, value);

  const destination = force ? `${target}.new` : target;
  writeFileSync(destination, out, { mode: 0o600 });
  console.log(`wrote ${destination}`);
  console.log("");
  console.log("Accounts are on. Next:");
  console.log("  pnpm dev:db     # Postgres on 127.0.0.1:5433");
  console.log("  pnpm dev        # canvas :5173, relay :1234/:1235, control plane :1236");
  console.log("");
  console.log("Billing is now configured from the admin panel at /admin: set the Stripe");
  console.log("keys, pick test or live, and turn billing on. Nothing to restart.");
  return 0;
}

process.exitCode = main();
