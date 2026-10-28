import { describe, expect, it } from "vitest";
import { SETTINGS, settingDefinition } from "./registry.js";
import { GLOBAL_SCOPE, orgScope, resolveAll, resolveSetting } from "./resolve.js";
import { decryptSetting, encryptSetting, isEncryptedSetting, SECRET_MASK } from "./secrets.js";

/**
 * Precedence is the promise the panel makes, so it is the thing under test: an
 * organization's row, then the deployment's, then the environment, then the default — and
 * the answer says which level spoke.
 */
describe("resolving a setting", () => {
  const rows = [
    { scope: GLOBAL_SCOPE, key: "mail.from", value: "Suite <global@example.test>" },
    { scope: orgScope("org-1"), key: "mail.from", value: "Suite <org@example.test>" },
  ];

  it("walks organization, global, env, default", () => {
    const env = { SUITE_MAIL_FROM: "Suite <env@example.test>" };

    expect(resolveSetting({ key: "mail.from", organizationId: "org-1", rows, env })).toMatchObject({
      value: "Suite <org@example.test>",
      source: "organization",
    });
    // Another organization has no row of its own, so the deployment's value answers.
    expect(resolveSetting({ key: "mail.from", organizationId: "org-2", rows, env })).toMatchObject({
      value: "Suite <global@example.test>",
      source: "global",
    });
    expect(resolveSetting({ key: "mail.from", rows: [], env })).toMatchObject({
      value: "Suite <env@example.test>",
      source: "env",
    });
    expect(resolveSetting({ key: "mail.from", rows: [], env: {} })).toMatchObject({
      source: "default",
    });
  });

  it("ignores an empty environment variable, which is how a shell unsets one", () => {
    expect(
      resolveSetting({ key: "mail.from", rows: [], env: { SUITE_MAIL_FROM: "" } })?.source,
    ).toBe("default");
  });

  it("only honours an organization row for a key that declares itself overridable", () => {
    const global = [
      { scope: GLOBAL_SCOPE, key: "billing.stripe.secretKey.test", value: "sk_global" },
    ];
    const org = [
      ...global,
      { scope: orgScope("org-1"), key: "billing.stripe.secretKey.test", value: "sk_org" },
    ];

    expect(
      resolveSetting({
        key: "billing.stripe.secretKey.test",
        organizationId: "org-1",
        rows: org,
        revealSecrets: true,
      }),
    ).toMatchObject({ value: "sk_global", source: "global" });
  });

  it("never returns a secret unless the caller is allowed to see it", () => {
    const rows = [{ scope: GLOBAL_SCOPE, key: "mail.smtp.password", value: "hunter2" }];

    expect(resolveSetting({ key: "mail.smtp.password", rows })).toMatchObject({
      value: null,
      secret: true,
    });
    expect(resolveSetting({ key: "mail.smtp.password", rows, revealSecrets: true })?.value).toBe(
      "hunter2",
    );
  });

  it("parses each kind, and refuses a value that will not parse", () => {
    const env = {
      SUITE_SMTP_PORT: "2525",
      SUITE_BILLING_ENABLED: "true",
      SUITE_BILLING_MODE: "live",
    };
    expect(resolveSetting({ key: "mail.smtp.port", rows: [], env })?.value).toBe(2525);
    expect(resolveSetting({ key: "billing.enabled", rows: [], env })?.value).toBe(true);
    expect(resolveSetting({ key: "billing.mode", rows: [], env })?.value).toBe("live");

    // A typo is null, and the panel shows the raw string beside the field rather than
    // taking the whole screen down.
    expect(
      resolveSetting({ key: "mail.smtp.port", rows: [], env: { SUITE_SMTP_PORT: "x" } })?.value,
    ).toBeNull();
    expect(
      resolveSetting({ key: "billing.mode", rows: [], env: { SUITE_BILLING_MODE: "sandbox" } })
        ?.value,
    ).toBeNull();
  });

  it("returns null for a key nobody declared", () => {
    expect(resolveSetting({ key: "not.a.setting", rows: [] })).toBeNull();
  });

  it("resolves every declared setting, in registry order", () => {
    const all = resolveAll({ rows: [] });
    expect(all.map((entry) => entry.key)).toEqual(SETTINGS.map((entry) => entry.key));
  });

  it("declares a fallback for every key, so a fresh install has a value", () => {
    for (const definition of SETTINGS) {
      expect(definition.fallback).toBeTypeOf("string");
      expect(definition.help.length).toBeGreaterThan(10);
      if (definition.kind === "enum") expect(definition.values?.length).toBeGreaterThan(0);
    }
  });

  it("keeps the bootstrap list free of anything the panel manages", () => {
    for (const definition of SETTINGS) {
      expect(definition.env ?? "").not.toBe("SUITE_SETTINGS_KEY");
    }
    expect(settingDefinition("billing.mode")?.group).toBe("billing");
  });
});

describe("secrets at rest", () => {
  const key = "a-deployment-key-long-enough";

  it("round-trips a value, and looks encrypted on the way through", () => {
    const stored = encryptSetting(key, "sk_test_123");

    expect(stored).not.toContain("sk_test_123");
    expect(isEncryptedSetting(stored)).toBe(true);
    expect(decryptSetting(key, stored)).toBe("sk_test_123");
  });

  it("fails closed on the wrong key", () => {
    const stored = encryptSetting(key, "sk_test_123");

    expect(() => decryptSetting("another-deployment-key-here", stored)).toThrow();
  });

  it("fails closed on a tampered value", () => {
    const stored = encryptSetting(key, "sk_test_123");
    const [version, iv, tag, body] = stored.split(".");
    const flipped = `${version}.${iv}.${tag}.${body?.slice(0, -2)}AA`;

    expect(() => decryptSetting(key, flipped)).toThrow();
  });

  it("refuses a key too short to be one", () => {
    expect(() => encryptSetting("short", "value")).toThrow(/at least 16/);
  });

  it("shows a mask, never a value, in the shape the panel reads", () => {
    expect(SECRET_MASK).not.toMatch(/[a-z0-9]/i);
  });
});

/**
 * The overlay is how a value that is only read at boot still comes from the panel: the boot
 * composes one environment and every feature keeps reading it.
 */
describe("the environment overlay", () => {
  it("lays a saved value over the variable it belongs to", async () => {
    const { envWithSettings } = await import("./overlay.js");
    const env = envWithSettings({
      env: { STRIPE_SECRET_KEY: "sk_from_env" },
      rows: [{ scope: GLOBAL_SCOPE, key: "billing.stripe.secretKey.test", value: "sk_from_panel" }],
    });

    expect(env.STRIPE_SECRET_KEY).toBe("sk_from_panel");
  });

  it("reveals a secret for the process that will use it", async () => {
    const { envWithSettings } = await import("./overlay.js");
    const env = envWithSettings({
      env: {},
      rows: [{ scope: GLOBAL_SCOPE, key: "mail.smtp.password", value: "hunter2" }],
    });

    expect(env.SUITE_SMTP_PASSWORD).toBe("hunter2");
  });

  it("leaves an unset variable unset when nothing supplies a value", async () => {
    const { envWithSettings } = await import("./overlay.js");
    const env = envWithSettings({ env: {}, rows: [] });

    // A default written as "" would read as "this is configured, and empty".
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("keeps a real environment value when no row overrides it", async () => {
    const { envWithSettings } = await import("./overlay.js");
    const env = envWithSettings({ env: { SUITE_BILLING_ENABLED: "1" }, rows: [] });

    expect(env.SUITE_BILLING_ENABLED).toBe("1");
  });

  it("names the keys that only apply on a restart", async () => {
    const { RESTART_KEYS } = await import("./overlay.js");

    expect(RESTART_KEYS).toContain("billing.mode");
    expect(RESTART_KEYS).toContain("mail.smtp.host");
    // A flag the app reads per request is not one of them.
    expect(RESTART_KEYS).not.toContain("flags.impersonation");
  });
});
