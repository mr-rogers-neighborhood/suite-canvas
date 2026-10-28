#!/usr/bin/env node
/**
 * One line per thing the stack needs, and the command that fixes it.
 *
 * The failure this exists for is "I do not know what state my machine is in": a database
 * that is not running, a `.env` that was never written, a control plane that cannot reach
 * Postgres, Stripe credentials half entered. Each of those surfaces somewhere different,
 * so the report is the map. It reads only — it changes nothing and starts nothing.
 *
 * Usage: pnpm doctor [--json]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = process.argv.includes("--json");

/** Runs a command and answers whether it exited zero. */
function runs(command, args = []) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The HTTP status of one URL, or null when nothing answered. */
async function statusOf(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // `manual` so a redirect to TLS still counts as an answer: the deployment is up even
    // when the certificate is one only the proxy knows about.
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    return response.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The values a `.env` holds, so a check can name one that is set but wrong. */
function readEnv() {
  const file = join(root, ".env");
  if (!existsSync(file)) return null;
  const values = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1]) values[match[1]] = (match[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return values;
}

async function main() {
  const env = readEnv();
  const checks = [];
  const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, fix });

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("Node", nodeMajor >= 22, `v${process.versions.node}`, "install Node 22 or newer");
  add("pnpm", runs("pnpm", ["--version"]), "on PATH", "corepack enable");
  add(
    "Docker",
    runs("docker", ["compose", "version"]),
    "compose available",
    "install Docker with the compose plugin",
  );

  add(".env", env !== null, env === null ? "missing" : "present", "pnpm setup");

  if (env !== null) {
    const secret = env.SUITE_SETTINGS_KEY ?? "";
    add(
      "settings key",
      secret.length >= 16,
      secret.length === 0 ? "SUITE_SETTINGS_KEY is empty" : `${secret.length} characters`,
      "pnpm setup --force, then copy the SUITE_SETTINGS_KEY line",
    );
    add(
      "auth secret",
      (env.SUITE_AUTH_SECRET ?? "").length >= 32,
      (env.SUITE_AUTH_SECRET ?? "").length === 0 ? "SUITE_AUTH_SECRET is empty" : "set",
      "pnpm setup --force, then copy the SUITE_AUTH_SECRET line",
    );
    add(
      "operators",
      (env.SUITE_ADMIN_EMAILS ?? "").trim().length > 0,
      (env.SUITE_ADMIN_EMAILS ?? "").trim().length > 0
        ? "named"
        : "SUITE_ADMIN_EMAILS names nobody",
      "add your address to SUITE_ADMIN_EMAILS; without one the panel refuses every request",
    );
  }

  const postgres = await statusOf("http://127.0.0.1:5433/");
  add(
    "Postgres :5433",
    postgres !== null,
    postgres === null ? "not reachable" : `answered ${postgres}`,
    "pnpm dev:db",
  );

  const relay = await statusOf("http://127.0.0.1:1235/health");
  add(
    "relay :1235",
    relay === 200,
    relay === null ? "not running" : `answered ${relay}`,
    "pnpm dev",
  );

  const control = await statusOf("http://127.0.0.1:1236/health");
  add(
    "control plane :1236",
    control === 200,
    control === null ? "not running" : `answered ${control}`,
    "pnpm dev, and read its first lines: a missing variable refuses the boot",
  );

  const canvas = await statusOf("http://127.0.0.1:5173/");
  add(
    "canvas :5173",
    canvas === 200,
    canvas === null ? "not running" : `answered ${canvas}`,
    "pnpm dev",
  );

  const stack = await statusOf("http://app.localhost/");
  add(
    "compose app.localhost",
    stack !== null,
    stack === null ? "not running" : `answered ${stack}`,
    "pnpm up",
  );

  if (json) {
    console.log(JSON.stringify({ checks }, null, 2));
    return checks.every((check) => check.ok) ? 0 : 1;
  }

  for (const check of checks) {
    const mark = check.ok ? "ok  " : "FAIL";
    const line = `${mark} ${check.name.padEnd(22)} ${check.detail}`;
    console.log(check.ok ? line : `${line}\n     fix: ${check.fix}`);
  }
  const failed = checks.filter((check) => !check.ok);
  console.log("");
  if (failed.length === 0) {
    console.log("Everything the local stack needs is up.");
    return 0;
  }
  console.log(`${failed.length} thing${failed.length === 1 ? "" : "s"} to fix, listed above.`);
  return 1;
}

process.exitCode = await main();
