#!/usr/bin/env node
/**
 * What is set up, and what is not.
 *
 * `pnpm dev` starts three processes and silently tolerates a missing fourth
 * dependency: with no Postgres the control plane refuses to boot, and with no
 * Stripe CLI billing quietly stays off. Both are correct behaviour and both look
 * like "the app is broken" when you have not read the docs recently.
 *
 * This prints one line per dependency, and each failing line names the single
 * command that fixes it. It never changes anything: no containers started, no
 * files written, no network calls beyond a localhost probe.
 *
 * Usage: node scripts/check-env.mjs    (run it as `pnpm check:env`)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const CONTROL_PLANE = 1236;
const RELAY_HEALTH = 1235;
const RELAY_SOCKET = 1234;
const CANVAS = 5173;
const DATABASE = Number(process.env.POSTGRES_PORT ?? 5433);

/** `ok`, `off`, `warn`, so a run can be read at a glance. */
const MARK = { ok: "ok  ", off: "FAIL", warn: "note" };

const lines = [];
let failures = 0;

function report(state, name, detail, fix) {
  if (state === "off") failures += 1;
  lines.push({ state, name, detail, fix });
}

function run(command, args) {
  try {
    return execFileSync(command, args, { cwd: root, stdio: "pipe", encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** Reads `.env` without exporting it: this script only looks. */
function readEnvFile() {
  const path = join(root, ".env");
  if (!existsSync(path)) return null;
  const values = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line);
    if (match) values.set(match[1], match[2].replace(/^["']|["']$/gu, ""));
  }
  return values;
}

/** A value counts as set when it is present and not a placeholder. */
function readValue(env, key) {
  const fromFile = env?.get(key);
  const fromProcess = process.env[key];
  const raw = (fromFile ?? fromProcess ?? "").trim();
  return raw.length > 0 ? raw : null;
}

function tcpOpen(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(700, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function httpOk(port, path) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(900),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  const env = readEnvFile();

  // --- toolchain ---------------------------------------------------------
  const node = process.versions.node;
  report(
    Number(node.split(".")[0]) >= 22 ? "ok" : "off",
    "Node 22 or newer",
    `v${node}`,
    "install Node 22: https://nodejs.org",
  );

  const pnpm = run("pnpm", ["--version"]);
  report(pnpm ? "ok" : "off", "pnpm", pnpm ?? "not on PATH", "corepack enable pnpm");

  const docker = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  report(
    docker ? "ok" : "off",
    "Docker",
    docker ?? "daemon not answering",
    "start Docker, or run Postgres yourself and set SUITE_AUTH_DATABASE_URL",
  );

  // --- the database -----------------------------------------------------
  const databaseUp = await tcpOpen(DATABASE);
  report(
    databaseUp ? "ok" : "off",
    `Postgres on 127.0.0.1:${DATABASE}`,
    databaseUp ? "accepting connections" : "nothing listening",
    "pnpm dev:db",
  );

  // --- configuration ----------------------------------------------------
  const authOn = readValue(env, "SUITE_AUTH_ENABLED") === "1";
  const authSecret = readValue(env, "SUITE_AUTH_SECRET");
  const authUrl = readValue(env, "SUITE_AUTH_URL");
  const authDb =
    readValue(env, "SUITE_CONTROL_PLANE_DATABASE_URL") ?? readValue(env, "SUITE_AUTH_DATABASE_URL");

  if (!existsSync(join(root, ".env"))) {
    report("off", ".env", "absent", "pnpm dev:env");
  } else if (!authOn) {
    report("off", "Accounts", "SUITE_AUTH_ENABLED is not 1", "pnpm dev:env");
  } else if (!authSecret || !authUrl || !authDb) {
    const missing = [
      authSecret ? null : "SUITE_AUTH_SECRET",
      authUrl ? null : "SUITE_AUTH_URL",
      authDb ? null : "SUITE_CONTROL_PLANE_DATABASE_URL",
    ].filter(Boolean);
    report("off", "Accounts", `missing ${missing.join(", ")}`, "pnpm dev:env");
  } else {
    report("ok", "Accounts", `configured for ${authUrl}`, null);
  }

  // --- billing ----------------------------------------------------------
  const billingOn = readValue(env, "SUITE_BILLING_ENABLED") === "1";
  const stripeKey = readValue(env, "STRIPE_SECRET_KEY");
  const webhookSecret = readValue(env, "STRIPE_WEBHOOK_SECRET");
  const priceTiers = readValue(env, "STRIPE_PRICE_TIERS");

  if (!billingOn) {
    report(
      "warn",
      "Billing",
      "off; sign-in, organizations and sync work without it",
      "set SUITE_BILLING_ENABLED=1 once the three values below exist",
    );
  } else {
    const missing = [
      stripeKey ? null : "STRIPE_SECRET_KEY",
      webhookSecret ? null : "STRIPE_WEBHOOK_SECRET",
      priceTiers ? null : "STRIPE_PRICE_TIERS",
    ].filter(Boolean);
    if (missing.length === 0) {
      report("ok", "Billing", "all four values present", null);
    } else {
      report(
        "warn",
        "Billing",
        `switched on but incomplete, missing ${missing.join(", ")}. It stays off until all four exist`,
        "pnpm stripe --login, then add what it prints",
      );
    }
  }

  const stripeCli = run("stripe", ["--version"]);
  report(
    stripeCli ? "ok" : "warn",
    "Stripe CLI",
    stripeCli ?? "not on PATH; billing cannot be set up or listened to",
    "see the install list in `pnpm stripe --help`",
  );

  // --- the processes ----------------------------------------------------
  const [canvasUp, controlUp, relayUp] = await Promise.all([
    httpOk(CANVAS, "/"),
    httpOk(CONTROL_PLANE, "/health"),
    httpOk(RELAY_HEALTH, "/health"),
  ]);

  report(
    canvasUp ? "ok" : "warn",
    `Canvas on :${CANVAS}`,
    canvasUp ? "serving" : "not running",
    "pnpm dev",
  );
  report(
    relayUp ? "ok" : "warn",
    `Relay on :${RELAY_HEALTH}`,
    relayUp ? "healthy" : "not running",
    "pnpm dev",
  );
  report(
    controlUp ? "ok" : "warn",
    `Control plane on :${CONTROL_PLANE}`,
    controlUp ? "healthy" : "not running",
    authOn ? "pnpm dev" : "pnpm dev:env, then pnpm dev",
  );

  for (const socketPort of [RELAY_SOCKET]) {
    const open = await tcpOpen(socketPort);
    report(
      open ? "ok" : "warn",
      `Relay socket on :${socketPort}`,
      open ? "listening" : "not listening",
      "pnpm dev",
    );
  }

  // --- print ------------------------------------------------------------
  const width = Math.max(...lines.map((line) => line.name.length));
  for (const line of lines) {
    console.log(`${MARK[line.state]}  ${line.name.padEnd(width)}  ${line.detail}`);
    // A suggestion under a passing line is noise: only the actionable ones get one.
    if (line.fix && line.state !== "ok") {
      console.log(`      ${" ".repeat(width)}  -> ${line.fix}`);
    }
  }

  console.log("");
  if (failures > 0) {
    console.log(`${failures} blocker(s). Fix those first; the notes can wait.`);
    return 1;
  }
  const notes = lines.filter((line) => line.state === "warn").length;
  console.log(
    notes === 0
      ? "Everything is in place. Open http://localhost:5173 and sign in."
      : `No blockers. ${notes} optional piece(s) are not set up, which is fine for signing in.`,
  );
  return 0;
}

process.exitCode = await main();
