#!/usr/bin/env node
/**
 * The money path, walked by a script instead of remembered.
 *
 * Billing and licence gating is the feature most likely to be wrong in a way nobody notices
 * until a customer is locked out or a test charge lands. So it gets evidence: this drives a
 * running stack over HTTP and asserts each state the gate can be in, plus the one property
 * that makes a mode switch safe — a webhook signed by the *other* mode is refused.
 *
 * What it needs, and what it does without:
 *
 * | Fact | Source | Without it |
 * | --- | --- | --- |
 * | The app origin | `SUITE_DOMAIN` / `--origin` | localhost |
 * | An operator session | `SUITE_DRILL_EMAIL`, `SUITE_DRILL_PASSWORD` | the licence steps are skipped |
 * | Stripe keys | the control plane's settings or the environment | the webhook steps are skipped |
 *
 * Nothing is charged: a licence row is written and cleared, and the webhook step posts a
 * body this script signs itself. The workspace it seeds is deleted at the end, including
 * after a failure, so a drill never leaves a fixture behind.
 *
 * Usage: pnpm drill:billing [--origin=https://app.localhost] [--keep]
 */
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const originArg = args.find((entry) => entry.startsWith("--origin="));
const origin = (
  originArg?.slice("--origin=".length) ??
  process.env.SUITE_DRILL_ORIGIN ??
  ""
).trim();
const base = (
  origin.length > 0 ? origin : `https://${process.env.SUITE_DOMAIN ?? "app.localhost"}`
).replace(/\/+$/u, "");

/**
 * A local stack serves a certificate Caddy issued to itself, so the drill trusts it where —
 * and only where — the host is a `*.localhost` name. A real deployment is verified.
 */
const host = new URL(base).hostname;
if (host === "localhost" || host.endsWith(".localhost")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= "0";
}

/**
 * `.env` is the fallback for what a drill needs and an operator would rather not retype.
 *
 * Only keys that are not already in the environment are taken, so an exported value always
 * wins and a shell that exports nothing still gets a usable run on the stack it just built.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match === null) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined || raw === undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/gu, "");
  }
}

const steps = [];
let failed = 0;

function record(name, verdict, detail) {
  steps.push({ name, verdict, detail });
  if (verdict === "FAIL") failed += 1;
  const mark = verdict === "pass" ? "pass" : verdict === "skip" ? "skip" : "FAIL";
  console.log(`  ${mark.padEnd(4)}  ${name}${detail === "" ? "" : ` — ${detail}`}`);
}

function pass(name, detail = "") {
  record(name, "pass", detail);
}

function skip(name, detail) {
  record(name, "skip", detail);
}

function fail(name, detail) {
  record(name, "FAIL", detail);
}

/** One request, with a cookie jar this script owns so the operator stays signed in. */
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function absorb(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    const [pair] = cookie.split(";");
    const index = pair?.indexOf("=") ?? -1;
    if (pair === undefined || index <= 0) continue;
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    // An empty value is the server deleting it, which the jar has to follow.
    if (value.length === 0) jar.delete(name);
    else jar.set(name, value);
  }
}

async function call(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      origin: base,
      ...(cookieHeader().length === 0 ? {} : { cookie: cookieHeader() }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  absorb(response);
  const text = await response.text();
  let json = null;
  try {
    json = text.length === 0 ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

/**
 * The relay's credential.
 *
 * `/api/admin/*` on the relay verifies a session JWT against the control plane's key set, so
 * the cookie the sign-in set is not enough: it has to be exchanged at `/api/auth/token`,
 * exactly as the app does. Minting one also proves the JWT path works, which the panel's
 * own routes never exercise.
 */
let bearer = "";

async function mintToken() {
  const response = await call("/api/auth/token");
  if (response.status !== 200 || typeof response.json?.token !== "string") {
    return `${response.status} ${response.text.slice(0, 80)}`;
  }
  bearer = response.json.token;
  return null;
}

/** One relay admin call, with the minted token. */
function relay(path, options = {}) {
  return call(path, {
    ...options,
    headers: { ...(options.headers ?? {}), authorization: `Bearer ${bearer}` },
  });
}

/** The operator's own session, or null when the drill cannot sign in. */
async function signIn() {
  const email = (process.env.SUITE_DRILL_EMAIL ?? "").trim();
  const password = process.env.SUITE_DRILL_PASSWORD ?? "";
  if (email.length === 0 || password.length === 0) return null;

  const response = await call("/api/auth/sign-in/email", {
    method: "POST",
    body: { email, password },
  });
  if (response.status !== 200) {
    skip("operator sign-in", `${response.status}; set SUITE_DRILL_EMAIL and SUITE_DRILL_PASSWORD`);
    return null;
  }
  if (response.json?.twoFactorRedirect === true) {
    skip("operator sign-in", "this operator has a second factor; use an account without one");
    return null;
  }
  pass("operator sign-in", email);
  const problem = await mintToken();
  if (problem !== null) {
    skip("the relay accepts the session", problem);
    return null;
  }
  pass("the relay accepts the session", "a session JWT was minted");
  return email;
}

/** The licence the relay reports for a workspace, as the panel reads it. */
async function licenceOf(workspaceId) {
  const listed = await relay("/api/admin/workspaces?limit=200");
  if (listed.status !== 200 || !Array.isArray(listed.json?.workspaces)) {
    return { error: `${listed.status} ${listed.text.slice(0, 80)}` };
  }
  const row = listed.json.workspaces.find((entry) => entry.id === workspaceId);
  if (row === undefined) return { error: "the seeded workspace is not in the list" };
  return { licence: row.licence };
}

async function walkLicenceStates(workspaceId) {
  const none = await licenceOf(workspaceId);
  if (none.error !== undefined) {
    fail("a fresh workspace has no licence", none.error);
    return;
  }
  if (none.licence === null) pass("a fresh workspace has no licence", "sync is refused");
  else fail("a fresh workspace has no licence", JSON.stringify(none.licence));

  const wrote = await relay(`/api/admin/workspaces/${workspaceId}/licence`, {
    method: "PUT",
    body: { state: "trial" },
  });
  if (wrote.status !== 200) {
    fail("a trial can be written", `${wrote.status} ${wrote.text.slice(0, 80)}`);
    return;
  }
  const trial = await licenceOf(workspaceId);
  if (trial.licence?.expired === false)
    pass("a trial allows sync", `expires ${trial.licence.expiresAt}`);
  else fail("a trial allows sync", JSON.stringify(trial.licence ?? trial.error));

  await relay(`/api/admin/workspaces/${workspaceId}/licence`, {
    method: "PUT",
    body: { state: "past-due" },
  });
  const pastDue = await licenceOf(workspaceId);
  if (pastDue.licence?.expired === true)
    pass("past due refuses sync", "the row is there and expired");
  else fail("past due refuses sync", JSON.stringify(pastDue.licence ?? pastDue.error));

  await relay(`/api/admin/workspaces/${workspaceId}/licence`, {
    method: "PUT",
    body: { state: "active" },
  });
  const active = await licenceOf(workspaceId);
  if (active.licence?.expired === false) pass("paying restores sync", active.licence.tier);
  else fail("paying restores sync", JSON.stringify(active.licence ?? active.error));

  await relay(`/api/admin/workspaces/${workspaceId}/licence`, { method: "DELETE" });
  const cancelled = await licenceOf(workspaceId);
  if (cancelled.licence === null)
    pass("cancelling clears the row", "which is what a lapsed account is");
  else fail("cancelling clears the row", JSON.stringify(cancelled.licence ?? cancelled.error));
}

/** A Stripe-shaped signature: `t=<seconds>,v1=<hmac of "t.body">`. */
function signStripe(body, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

const WEBHOOK_BODY = JSON.stringify({
  id: "evt_drill_0001",
  object: "event",
  type: "customer.subscription.updated",
  data: { object: { id: "sub_drill", object: "subscription", status: "active" } },
});

/**
 * The assertion this drill exists for.
 *
 * Both credential sets live in the settings table and the mode decides which one the process
 * holds, so a webhook signed by the *other* mode must fail verification rather than write a
 * licence. Without both sets there is nothing to compare, and the step says so.
 */
async function checkModePinning() {
  const settings = await call("/admin/settings");
  if (settings.status !== 200 || !Array.isArray(settings.json?.settings)) {
    skip("the billing mode is readable", `${settings.status}; sign in as an operator`);
    return;
  }
  const mode = settings.json.settings.find((entry) => entry.key === "billing.mode")?.value;
  pass("the billing mode is readable", String(mode));

  const active = mode === "live" ? "live" : "test";
  const inactiveSecret =
    active === "live" ? process.env.STRIPE_WEBHOOK_SECRET : process.env.STRIPE_WEBHOOK_SECRET_LIVE;
  const activeSecret =
    active === "live" ? process.env.STRIPE_WEBHOOK_SECRET_LIVE : process.env.STRIPE_WEBHOOK_SECRET;

  if (activeSecret === undefined || activeSecret.trim().length === 0) {
    skip(
      "an event signed by the active mode is accepted",
      `STRIPE_WEBHOOK_SECRET for ${active} is not set here`,
    );
    return;
  }
  const accepted = await call("/api/auth/stripe/webhook", {
    method: "POST",
    body: WEBHOOK_BODY,
    headers: { "stripe-signature": signStripe(WEBHOOK_BODY, activeSecret.trim()) },
  });
  if (accepted.status >= 200 && accepted.status < 300)
    pass("an event signed by the active mode is accepted");
  else
    fail(
      "an event signed by the active mode is accepted",
      `${accepted.status} ${accepted.text.slice(0, 80)}`,
    );

  if (inactiveSecret === undefined || inactiveSecret.trim().length === 0) {
    skip("an event signed by the other mode is refused", "only one credential set is configured");
    return;
  }
  const refused = await call("/api/auth/stripe/webhook", {
    method: "POST",
    body: WEBHOOK_BODY,
    headers: { "stripe-signature": signStripe(WEBHOOK_BODY, inactiveSecret.trim()) },
  });
  if (refused.status >= 400)
    pass("an event signed by the other mode is refused", `status ${refused.status}`);
  else
    fail(
      "an event signed by the other mode is refused",
      `status ${refused.status}: it was accepted`,
    );
}

async function main() {
  console.log(`drill: billing and licence gating against ${base}\n`);

  const reachable = await call("/health");
  if (reachable.status !== 200) {
    console.error(`the stack is not answering at ${base} (/health ${reachable.status}).`);
    console.error("start it with `pnpm up`, or pass --origin=<url>.");
    return 1;
  }
  pass("the stack answers", "/health 200");

  const signedIn = await signIn();
  const workspaceId = `drill-${Date.now()}`;
  let seeded = false;

  try {
    if (signedIn !== null) {
      const fixture = await relay("/api/admin/fixtures", {
        method: "POST",
        body: { workspaceId, board: "Drill" },
      });
      seeded = fixture.status === 200 || fixture.status === 201;
      if (seeded) pass("a drill workspace exists", workspaceId);
      else fail("a drill workspace exists", `${fixture.status} ${fixture.text.slice(0, 120)}`);

      if (seeded) await walkLicenceStates(workspaceId);
    } else {
      skip("the licence states", "no operator session");
    }

    await checkModePinning();
  } finally {
    if (seeded && !keep) {
      const removed = await relay(`/api/admin/workspaces/${workspaceId}`, {
        method: "DELETE",
        body: { confirm: workspaceId },
      });
      if (removed.status === 200) pass("the drill workspace is gone");
      else fail("the drill workspace is gone", `${removed.status} ${removed.text.slice(0, 80)}`);
    }
  }

  const passed = steps.filter((step) => step.verdict === "pass").length;
  const skipped = steps.filter((step) => step.verdict === "skip").length;
  console.log(`\n${passed} passed, ${skipped} skipped, ${failed} failed`);
  if (failed > 0) {
    console.error("drill FAILED: the money path is not what this script expects.");
    return 1;
  }
  if (skipped > 0) {
    const names = steps.filter((step) => step.verdict === "skip").map((step) => step.name);
    console.log(`drill passed with ${skipped} step(s) skipped, so the money path is unproven:`);
    for (const name of names) console.log(`  skipped: ${name}`);
    return 0;
  }
  console.log(
    "drill passed: every licence state the gate can be in was walked, and the other mode's event was refused.",
  );
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`drill could not run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
