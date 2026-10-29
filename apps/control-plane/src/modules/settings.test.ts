import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptSetting, isEncryptedSetting } from "@suite/settings";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../logging.js";
import { memoryAuditStore } from "./audit.js";
import type { verifyStripeProfile } from "./auth-billing.js";
import { publishSessionReader } from "./context.js";
import { createSettingsModule, SETTINGS_PATH, settingsBody } from "./settings.js";

/**
 * The settings surface: precedence, provenance and the two things that must not leak.
 *
 * The SQL is a stub of two statements, which is enough to pin what the handler decides —
 * that the panel's row wins over the environment, that a secret is stored encrypted and
 * read as a mask, and that a key nobody declared cannot be created by asking for it.
 */
const SETTINGS_KEY = "a-settings-key-long-enough";

interface Row {
  scope: string;
  key: string;
  value: string;
}

/** A pool double: the two reads the module makes, and the two writes. */
function poolDouble(rows: Row[]) {
  return {
    async query(sql: string, params?: unknown[]) {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("SELECT scope, key, value")) return { rows: [...rows] };
      if (text.startsWith("INSERT INTO suite_settings")) {
        const [scope, key, value] = params as [string, string, string];
        const at = rows.findIndex((row) => row.scope === scope && row.key === key);
        const next = { scope, key, value };
        if (at >= 0) rows[at] = next;
        else rows.push(next);
        return { rows: [] };
      }
      if (text.startsWith("DELETE FROM suite_settings")) {
        const [scope, key] = params as [string, string];
        const at = rows.findIndex((row) => row.scope === scope && row.key === key);
        if (at >= 0) rows.splice(at, 1);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

let directory = "";
let server: Server | null = null;
let baseUrl = "";
let rows: Row[] = [];

beforeEach(() => {
  process.env.SUITE_SETTINGS_KEY = SETTINGS_KEY;
  directory = mkdtempSync(join(tmpdir(), "suite-settings-"));
  rows = [];
  publishSessionReader(async (headers) => {
    const token = headers.authorization?.replace(/^Bearer /, "");
    if (token !== "operator") return null;
    return {
      userId: "user-operator",
      organizationId: null,
      role: null,
      admittedAt: 0,
      operator: true,
    };
  });
});

afterEach(async () => {
  const closing = server;
  if (closing) await new Promise<void>((resolve) => closing.close(() => resolve()));
  server = null;
  delete process.env.SUITE_SETTINGS_KEY;
  publishSessionReader(async () => null);
  rmSync(directory, { recursive: true, force: true });
});

let trail: ReturnType<typeof memoryAuditStore> | null = null;

/**
 * The Stripe check a test gets when it does not ask for one: nothing was learned, which is
 * the answer that refuses no write. A test that wants a refusal passes its own.
 */
const unreachableCheck = async (env: never, mode: "test" | "live") => ({
  mode,
  reachable: false,
  keyWorks: false,
  coupon: null,
  prices: [],
  problem: `Stripe could not be reached: stub (${String(env !== null)})`,
  ok: false,
});

async function start(
  overrides: Record<string, string> = {},
  verify: typeof verifyStripeProfile = unreachableCheck as never,
): Promise<void> {
  trail = memoryAuditStore();
  const module = createSettingsModule({
    env: { SUITE_CONTROL_PLANE_DATABASE_URL: "postgres://stub/suite", ...overrides } as never,
    logger: createLogger(),
    pool: poolDouble(rows) as never,
    audit: trail,
    verifyProfile: verify,
  });
  const listening = createServer((request: IncomingMessage, response: ServerResponse) => {
    void Promise.resolve(module.handle(request, response))
      .then((handled: boolean) => {
        if (handled || response.writableEnded) return;
        response.writeHead(404).end("not found");
      })
      .catch((error: unknown) => {
        response.writeHead(500).end(String(error));
      });
  });
  server = listening;
  await new Promise<void>((resolve) => {
    listening.listen(0, "127.0.0.1", resolve);
  });
  const address = listening.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

function call(
  method: "GET" | "PUT" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  token = "operator",
) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: ["Bearer", token].join(" "),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("the settings module", () => {
  it("lists every declared key with its value and the level that supplied it", async () => {
    await start();
    rows.push({ scope: "global", key: "mail.smtp.port", value: "2525" });

    const response = await call("GET", SETTINGS_PATH);
    const body = (await response.json()) as {
      settings: { key: string; value: unknown; source: string }[];
    };

    expect(response.status).toBe(200);
    const port = body.settings.find((entry) => entry.key === "mail.smtp.port");
    // A saved row is the panel's, so it outranks the environment default.
    expect(port).toMatchObject({ value: 2525, source: "global" });
    const mode = body.settings.find((entry) => entry.key === "billing.mode");
    expect(mode?.source).toBe("default");
  });

  it("stores a secret encrypted and reads it back as a mask", async () => {
    await start();

    const write = await call("PUT", `${SETTINGS_PATH}/billing.stripe.secretKey.test`, {
      value: "sk_test_123",
    });
    expect(write.status).toBe(200);

    const stored = rows.find((row) => row.key === "billing.stripe.secretKey.test")?.value ?? "";
    expect(stored).not.toContain("sk_test_123");
    expect(isEncryptedSetting(stored)).toBe(true);
    // Two writes of the same value differ: the IV is fresh each time.
    expect(stored).not.toBe(encryptSetting(SETTINGS_KEY, "sk_test_123"));

    const read = await call("GET", SETTINGS_PATH);
    const body = (await read.json()) as { settings: { key: string; value: unknown }[] };
    const secret = body.settings.find((entry) => entry.key === "billing.stripe.secretKey.test");
    expect(secret?.value).not.toBe("sk_test_123");
    expect(String(secret?.value)).toMatch(/•/);

    // The same key is still decryptable in-process, which is what a sender needs.
    const { decryptSetting } = await import("@suite/settings");
    expect(decryptSetting(SETTINGS_KEY, stored)).toBe("sk_test_123");
  });

  it("refuses a secret when the deployment holds no settings key", async () => {
    await start();
    delete process.env.SUITE_SETTINGS_KEY;

    const response = await call("PUT", `${SETTINGS_PATH}/mail.smtp.password`, { value: "hunter2" });

    expect(response.status).toBe(503);
    expect(rows).toHaveLength(0);
  });

  it("accepts only the values an enum declares", async () => {
    await start();

    const refused = await call("PUT", `${SETTINGS_PATH}/billing.mode`, { value: "sandbox" });
    expect(refused.status, await refused.clone().text()).toBe(400);
    expect(rows).toHaveLength(0);

    const accepted = await call("PUT", `${SETTINGS_PATH}/billing.mode`, { value: "live" });
    expect(accepted.status).toBe(200);
    expect(rows[0]).toMatchObject({ key: "billing.mode", value: "live" });
  });

  it("refuses a mode whose prices Stripe has never heard of", async () => {
    // The mistake a copied table makes: everything parses, the key works, and every price
    // belongs to the other mode. Refusing here is the difference between a bad evening and
    // a customer whose checkout cannot open.
    await start(
      {
        SUITE_BILLING_ENABLED: "1",
        SUITE_BILLING_MODE: "test",
        STRIPE_SECRET_KEY: "sk_test_x",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
        STRIPE_PRICE_TIERS:
          '{"price_solo":{"tier":"solo","workspaces":1,"documentBytes":1,"attachmentBytes":1}}',
        STRIPE_SECRET_KEY_LIVE: "sk_live_x",
        STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live",
        STRIPE_PRICE_TIERS_LIVE:
          '{"price_solo":{"tier":"solo","workspaces":1,"documentBytes":1,"attachmentBytes":1}}',
      },
      async (_env, mode) => ({
        mode,
        reachable: true,
        keyWorks: true,
        coupon: null,
        prices: [{ priceId: "price_solo", tier: "solo", exists: false }],
        problem: "price_solo does not exist in live mode",
        ok: false,
      }),
    );

    const refused = await call("PUT", `${SETTINGS_PATH}/billing.mode`, { value: "live" });

    expect(refused.status, await refused.clone().text()).toBe(400);
    const body = (await refused.json()) as { error: string; message: string };
    expect(body.error).toBe("billing-profile-unusable");
    expect(body.message).toContain("price_solo does not exist in live mode");
    expect(rows).toHaveLength(0);
  });

  it("switches when Stripe confirms the key and every price", async () => {
    await start(
      {
        SUITE_BILLING_ENABLED: "1",
        SUITE_BILLING_MODE: "test",
        STRIPE_SECRET_KEY_LIVE: "sk_live_x",
        STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live",
        STRIPE_PRICE_TIERS_LIVE:
          '{"price_solo":{"tier":"solo","workspaces":1,"documentBytes":1,"attachmentBytes":1}}',
      },
      async (_env, mode) => ({
        mode,
        reachable: true,
        keyWorks: true,
        coupon: null,
        prices: [{ priceId: "price_solo", tier: "solo", exists: true }],
        problem: null,
        ok: true,
      }),
    );

    const accepted = await call("PUT", `${SETTINGS_PATH}/billing.mode`, { value: "live" });

    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(rows[0]).toMatchObject({ key: "billing.mode", value: "live" });
  });

  it("does not refuse a switch because the network was down", async () => {
    await start(
      {
        SUITE_BILLING_ENABLED: "1",
        SUITE_BILLING_MODE: "test",
        STRIPE_SECRET_KEY_LIVE: "sk_live_x",
        STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live",
        STRIPE_PRICE_TIERS_LIVE:
          '{"price_solo":{"tier":"solo","workspaces":1,"documentBytes":1,"attachmentBytes":1}}',
      },
      unreachableCheck as never,
    );

    const accepted = await call("PUT", `${SETTINGS_PATH}/billing.mode`, { value: "live" });

    expect(accepted.status, await accepted.clone().text()).toBe(200);
  });

  it("checks a profile without switching to it", async () => {
    await start(
      {
        SUITE_BILLING_ENABLED: "1",
        STRIPE_SECRET_KEY: "sk_test_x",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
        STRIPE_PRICE_TIERS:
          '{"price_solo":{"tier":"solo","workspaces":1,"documentBytes":1,"attachmentBytes":1}}',
      },
      async (_env, mode) => ({
        mode,
        reachable: true,
        keyWorks: true,
        coupon: null,
        prices: [{ priceId: "price_solo", tier: "solo", exists: true }],
        problem: null,
        ok: true,
      }),
    );

    const checked = await call("POST", `${SETTINGS_PATH}/billing/verify`, { mode: "test" });

    expect(checked.status, await checked.clone().text()).toBe(200);
    expect(await checked.json()).toMatchObject({ mode: "test", keyWorks: true, ok: true });
    // A check is not a choice: nothing was written.
    expect(rows).toHaveLength(0);
  });

  it("refuses an organization override for a deployment-wide key", async () => {
    await start();

    const response = await call("PUT", `${SETTINGS_PATH}/billing.mode?organization=org-1`, {
      value: "live",
    });

    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it("writes an organization override for a key that declares itself overridable", async () => {
    await start();

    const response = await call("PUT", `${SETTINGS_PATH}/mail.from?organization=org-1`, {
      value: "Suite <org@example.test>",
    });

    expect(response.status).toBe(200);
    expect(rows[0]).toMatchObject({ scope: "org:org-1", key: "mail.from" });
  });

  it("resets a key back to the level below it", async () => {
    await start();
    await call("PUT", `${SETTINGS_PATH}/mail.smtp.port`, { value: "2525" });

    const response = await call("DELETE", `${SETTINGS_PATH}/mail.smtp.port`);

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(0);
  });

  it("refuses a key nobody declared", async () => {
    await start();

    const response = await call("PUT", `${SETTINGS_PATH}/not.a.setting`, { value: "x" });

    expect(response.status).toBe(404);
    expect(rows).toHaveLength(0);
  });

  it("needs an operator, and says which refusal it is", async () => {
    await start();

    const anonymous = await call("GET", SETTINGS_PATH, undefined, "nobody");
    expect(anonymous.status).toBe(401);
  });

  it("reports provenance in the body the panel reads", () => {
    const body = settingsBody([{ scope: "global", key: "billing.mode", value: "live" }], null);
    const mode = body.settings.find((entry) => entry.key === "billing.mode");

    expect(mode?.source).toBe("global");
    expect(mode?.value).toBe("live");
    // Every row carries where a boot value would come from, so the panel can explain it.
    expect(mode?.env).toBe("SUITE_BILLING_MODE");
  });
});

describe("the two Stripe profiles", () => {
  /** A complete set for one mode, named the way the environment names it. */
  const profile = (suffix: "" | "_LIVE") => ({
    [`STRIPE_SECRET_KEY${suffix}`]: "sk_x",
    [`STRIPE_WEBHOOK_SECRET${suffix}`]: "whsec_x",
    [`STRIPE_PRICE_TIERS${suffix}`]: JSON.stringify({
      [`price_${suffix === "" ? "test" : "live"}`]: {
        tier: "personal",
        workspaces: 3,
        documentBytes: 1024,
        attachmentBytes: 1024,
      },
    }),
  });

  it("reports what each profile has, so a switch is not a discovery", async () => {
    await start(profile(""));
    const response = await call("GET", SETTINGS_PATH);
    const body = (await response.json()) as {
      billing: {
        active: string;
        profiles: Record<string, { complete: boolean; missing: string[]; plans: number | null }>;
      };
    };

    expect(body.billing.active).toBe("test");
    expect(body.billing.profiles.test).toMatchObject({ complete: true, plans: 1, missing: [] });
    // The live half is empty and says which three keys it is waiting for.
    expect(body.billing.profiles.live?.complete).toBe(false);
    expect(body.billing.profiles.live?.missing).toEqual([
      "billing.stripe.secretKey.live",
      "billing.stripe.webhookSecret.live",
      "billing.stripe.prices.live",
    ]);
  });

  it("refuses a switch to a profile that would boot billing off", async () => {
    await start({ ...profile(""), SUITE_BILLING_ENABLED: "1" });

    const refused = await call("PUT", `${SETTINGS_PATH}/billing.mode`, { value: "live" });

    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { message?: string; error?: string };
    expect(body.error).toBe("billing-profile-incomplete");
    expect(body.message).toContain("billing.stripe.secretKey.live");
    // Nothing was written: the deployment keeps the mode it is actually spending.
    expect(rows).toHaveLength(0);
  });

  it("allows the switch once the other profile is complete", async () => {
    await start({ ...profile(""), ...profile("_LIVE"), SUITE_BILLING_ENABLED: "1" });

    const accepted = await call("PUT", `${SETTINGS_PATH}/billing.mode`, { value: "live" });

    expect(accepted.status).toBe(200);
    expect(rows[0]).toMatchObject({ key: "billing.mode", value: "live" });
  });

  it("refuses a price table that does not parse, rather than finding out at boot", async () => {
    await start({ SUITE_BILLING_ENABLED: "1" });

    const refused = await call("PUT", `${SETTINGS_PATH}/billing.stripe.prices.test`, {
      value: '{"price_1":{"tier":"personal"}}',
    });

    expect(refused.status).toBe(400);
    expect(rows).toHaveLength(0);
  });
});

describe("the audit trail", () => {
  it("records a write with the value it moved to, and a secret only as a replacement", async () => {
    await start();

    await call("PUT", `${SETTINGS_PATH}/billing.mode`, { value: "test" });
    await call("PUT", `${SETTINGS_PATH}/billing.stripe.secretKey.test`, { value: "sk_test_123" });

    const entries = trail?.entries ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      actor: "user-operator",
      action: "settings.write",
      target: "billing.mode",
      outcome: "ok",
      details: { scope: "global", value: "test" },
    });
    // The secret's value is nowhere in the trail: an audit table is not a keystore.
    expect(entries[1]?.details).toEqual({ scope: "global", secret: true });
    expect(JSON.stringify(entries)).not.toContain("sk_test_123");
  });

  it("records a reset as its own act", async () => {
    await start();
    await call("PUT", `${SETTINGS_PATH}/billing.mode`, { value: "test" });

    await call("DELETE", `${SETTINGS_PATH}/billing.mode`);

    expect(trail?.entries.at(-1)).toMatchObject({
      action: "settings.reset",
      target: "billing.mode",
      outcome: "ok",
    });
  });

  it("writes nothing for a refusal, which changed no setting", async () => {
    await start();

    await call("PUT", `${SETTINGS_PATH}/billing.mode`, { value: "sandbox" });

    expect(trail?.entries ?? []).toHaveLength(0);
  });
});
