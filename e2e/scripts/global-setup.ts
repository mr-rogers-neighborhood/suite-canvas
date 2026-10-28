#!/usr/bin/env node
/**
 * The one sign-in of a run, done once, so no spec drives a form.
 *
 * Playwright's `storageState` is the mechanism: this file creates a real account
 * session against the control plane, writes the cookies to `e2e/.data/account.json`,
 * and every spec that declares `test.use({ storageState: ACCOUNT_STATE })` —
 * including the ones that call `browser.newContext()` by hand, because Playwright
 * merges `use` options into every context it creates — opens its pages already
 * signed in. The session cookie is httpOnly, so the browser is the only place it
 * can live and a browser-side sign-in is the honest way to get one; doing it once
 * here is cheaper than doing it per page and keeps the specs about the canvas.
 *
 * ## Why an anonymous Better Auth user
 *
 * `POST /api/auth/sign-in/anonymous` is the product's own account-less rung
 * (ADR-0077): a real `user` row and a real session, which the anonymous plugin
 * later links to a real account. Sign-up would work too, but it needs a verified
 * mailbox, and the development transport prints the verification link into the
 * control-plane log — a log scrape in the fixture for the same row. The relay only
 * reads `sub`, `org` and `role`, all of which this session has.
 *
 * ## Why the organization is provisioned in SQL
 *
 * It cannot be created through the API in this checkout. `beforeAddMember` in
 * `services/auth/src/identity/betterAuth.ts` refuses the creator's own membership
 * with `seat-refused: licence-missing` when the organization has no licence row, and this
 * harness signs in as an anonymous account that never pays, so no subscription webhook
 * would be reachable here only through Stripe. So the harness writes the three rows a paid
 * deployment's billing webhook would write — organization, owner member, licence — replacing
 * the free row `0009_free_licence_provisioning.sql` wrote, then drives the rest (`set-active`,
 * the token mint, the workspace claim) through the product's own HTTP API.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type APIResponse, request as playwrightRequest } from "@playwright/test";

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(E2E_DIR, ".data");

/** Where `test.use({ storageState })` points. Exported for `fixtures/account.ts`. */
export const ACCOUNT_STATE_PATH = path.join(DATA_DIR, "account.json");

/** The control plane's own listener, for the readiness probe. */
const CONTROL_PLANE = "http://localhost:1236";

/**
 * The origin the account API is called *through* (`scripts/hosted-origin.mjs`).
 * Same host, same cookie; using it rather than the port keeps every request in
 * this file in the origin Better Auth thinks it serves.
 */
const ACCOUNT_ORIGIN = "http://localhost:5180";

/** The connection the control-plane script's cluster answers on. */
const PG = { host: "127.0.0.1", port: "54329", user: "suite", database: "suite" };

/** Licence ceilings generous enough that a run never spends them. */
const RUN_LICENCE = {
  id: "e2e-licence",
  tier: "personal",
  workspaces: 10_000,
  seats: 1_000,
  /** A year: the row outlives the run, and a stale one is deleted with the cluster. */
  days: 365,
};

function psql(sql: string): string {
  return execFileSync("psql", ["-tAc", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PGHOST: PG.host,
      PGPORT: PG.port,
      PGUSER: PG.user,
      PGDATABASE: PG.database,
    },
  }).trim();
}

/**
 * The setup account.
 *
 * One per run, because a cluster left behind by an interrupted run still holds
 * the previous address and a sign-up would then be refused as a duplicate. The
 * password is fixed: nothing else knows it, and the session cookie is what the
 * specs use.
 */
const RUN_EMAIL = `e2e-${crypto.randomUUID().slice(0, 8)}@example.com`;
const RUN_PASSWORD = "e2e-run-password-not-a-secret";

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

/** One line per row, quoted for SQL. Ids and slugs are generated here, never user input. */
function provisionOrganization(userId: string): string {
  const organizationId = randomId("org");
  const memberId = randomId("mem");
  const slug = `e2e-${organizationId}`;
  psql(
    `
    INSERT INTO organization (id, name, slug) VALUES ('${organizationId}', 'E2E', '${slug}');
    INSERT INTO member (id, "organizationId", "userId", role)
      VALUES ('${memberId}', '${organizationId}', '${userId}', 'owner');
    -- The 0009 trigger already wrote a free row in the organization's own
    -- transaction, so this is an upsert, not an insert: the run's row replaces it.
    INSERT INTO organization_licences
      (organization_id, licence_id, tier, workspaces, seats, expires_at)
      VALUES (
        '${organizationId}',
        '${RUN_LICENCE.id}',
        '${RUN_LICENCE.tier}',
        ${RUN_LICENCE.workspaces},
        ${RUN_LICENCE.seats},
        now() + interval '${RUN_LICENCE.days} days'
      )
    ON CONFLICT (organization_id) DO UPDATE SET
      licence_id = EXCLUDED.licence_id,
      tier       = EXCLUDED.tier,
      workspaces = EXCLUDED.workspaces,
      seats      = EXCLUDED.seats,
      expires_at = EXCLUDED.expires_at;
    `,
  );
  return organizationId;
}

/** A body that must have said yes, with the refusal quoted when it did not. */
async function expectOk(response: APIResponse, what: string): Promise<APIResponse> {
  if (!response.ok()) {
    throw new Error(
      `${what} failed: ${response.status()} ${(await response.text()).slice(0, 400)}`,
    );
  }
  return response;
}

/** Whether this machine can run the cluster the control plane needs. */
function postgresInstalled(): boolean {
  return spawnSync("initdb", ["--version"], { stdio: "ignore" }).error === undefined;
}

export default async function globalSetup(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  rmSync(ACCOUNT_STATE_PATH, { force: true });

  // No Postgres, no control plane, no account: the local specs still run, and the
  // ones that declare `test.use({ storageState })` fail on a refused connection to
  // the hosted origin. Saying so once here beats an unexplained connection error in
  // thirty specs.
  if (!postgresInstalled()) {
    console.warn(
      "e2e account: initdb is not on PATH, so the control plane is not running and every spec that needs an account will fail. Install PostgreSQL to run the account, collab and sharing specs.",
    );
    return;
  }

  const api = await playwrightRequest.newContext({ baseURL: ACCOUNT_ORIGIN });
  try {
    // The readiness probe goes to the process itself: `/health` is the host's own
    // route and the proxy forwards only the account prefixes.
    const health = await api.get(`${CONTROL_PLANE}/health`).catch(() => null);
    if (health === null || !health.ok()) {
      throw new Error(
        `the control plane is not answering on ${CONTROL_PLANE}. The account specs need it: start PostgreSQL (the harness runs its own cluster on :54329) and re-run.`,
      );
    }

    // A real account, signed up the way a person signs up. The suite used to take
    // an anonymous session here; there is no anonymous sign-in any more, and a
    // session with no account would be refused by the relay anyway.
    const signedIn = await expectOk(
      await api.post("/api/auth/sign-up/email", {
        data: { email: RUN_EMAIL, password: RUN_PASSWORD, name: "E2E" },
      }),
      "the account sign-up",
    );
    const session: unknown = await signedIn.json();
    const userId =
      typeof session === "object" && session !== null
        ? (session as { user?: { id?: unknown } }).user?.id
        : undefined;
    if (typeof userId !== "string" || userId.length === 0) {
      throw new Error("the sign-up returned no user id");
    }

    const organizationId = provisionOrganization(userId);
    await expectOk(
      await api.post("/api/auth/organization/set-active", { data: { organizationId } }),
      "selecting the run's organization",
    );

    await api.storageState({ path: ACCOUNT_STATE_PATH });
    console.log(
      `e2e account: user ${userId} in ${organizationId}, session written to .data/account.json`,
    );
  } finally {
    await api.dispose();
  }
}
