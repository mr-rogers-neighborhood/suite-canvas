import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type ConfigEnv,
  MIN_TOKEN_LENGTH,
  packageVersion,
  serverVersion,
  validateConfig,
} from "./config.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const srcDirectory = fileURLToPath(new URL(".", import.meta.url));

/** A public key in the shape `licence.ts` parses, without a fixed fixture. */
function licencePublicKeyPem(): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  return publicKey.export({ type: "spki", format: "pem" }).toString();
}

function variables(env: ConfigEnv): string[] {
  return validateConfig(env).problems.map((problem) => problem.variable);
}

describe("validateConfig", () => {
  it("accepts a minimal configuration and fills the defaults", () => {
    const result = validateConfig({});

    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.config.ports).toEqual({ ws: 1234, health: 1235 });
    expect(result.config.paths).toEqual({
      documents: "suite.documents.sqlite",
      shares: "suite.shares.sqlite",
      workspaces: "suite.workspaces.sqlite",
      settings: null,
      licences: null,
      attachments: null,
    });
    expect(result.config.tokens).toEqual({ admin: null, projection: null, source: null });
    expect(result.config.hosted).toBe(false);
    expect(result.config.allowedOrigins).toEqual(["*"]);
    expect(result.config.logLevel).toBe("info");
    expect(result.config.rateLimits).toEqual({
      claim: 600,
      rotate: 10,
      shareResolve: 300,
      shareCreate: 30,
      publish: 20,
      admin: 300,
    });
    expect(Number.isFinite(result.config.limits.selectionCards)).toBe(true);
  });

  it("accepts a complete configuration and keeps every value", () => {
    const token = "a".repeat(MIN_TOKEN_LENGTH);
    const result = validateConfig({
      PORT: "4000",
      HEALTH_PORT: "4001",
      SUITE_DB: "data/documents.sqlite",
      SUITE_SHARES_DB: "data/shares.sqlite",
      SUITE_WORKSPACES_DB: "data/workspaces.sqlite",
      SUITE_SETTINGS_DB: ":memory:",
      SUITE_LICENCE_DB: "data/licences.sqlite",
      SUITE_ADMIN_TOKEN: token,
      SUITE_PROJECTION_TOKEN: `${token}-projection`,
      SUITE_SOURCE_TOKEN: `${token}-source`,
      SUITE_ALLOWED_ORIGINS: "https://canvas.example.com, http://localhost:5173",
      SUITE_TRUST_PROXY: "1",
      SUITE_LOG_LEVEL: "warn",
      SUITE_MAX_WORKSPACES: "4",
      SUITE_MAX_SHARES_PER_WORKSPACE: "7",
      SUITE_CLAIM_RATE_LIMIT: "42",
      SUITE_VERSION: "1.4.0",
    });

    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.config.ports).toEqual({ ws: 4000, health: 4001 });
    expect(result.config.paths.documents).toBe("data/documents.sqlite");
    expect(result.config.paths.settings).toBe(":memory:");
    expect(result.config.tokens.admin).toBe(token);
    expect(result.config.allowedOrigins).toEqual([
      "https://canvas.example.com",
      "http://localhost:5173",
    ]);
    expect(result.config.trustProxy).toBe(true);
    expect(result.config.logLevel).toBe("warn");
    expect(result.config.rateLimits.claim).toBe(42);
    expect(result.config.limits.maxWorkspaces).toBe(4);
    expect(result.config.limits.sharesPerWorkspace).toBe(7);
    expect(result.config.version).toBe("1.4.0");
  });

  const invalid: readonly [string, ConfigEnv, string][] = [
    ["a non-numeric port", { PORT: "eight" }, "PORT"],
    ["a port above 65535", { PORT: "70000" }, "PORT"],
    ["a health port of zero", { HEALTH_PORT: "0" }, "HEALTH_PORT"],
    ["a blank health port", { HEALTH_PORT: " " }, "HEALTH_PORT"],
    ["one port for both listeners", { PORT: "1235", HEALTH_PORT: "1235" }, "HEALTH_PORT"],
    ["an empty document path", { SUITE_DB: "" }, "SUITE_DB"],
    ["a directory as the share database", { SUITE_SHARES_DB: srcDirectory }, "SUITE_SHARES_DB"],
    [
      "two stores in one file",
      { SUITE_DB: "same.sqlite", SUITE_WORKSPACES_DB: "same.sqlite" },
      "SUITE_WORKSPACES_DB",
    ],
    ["an empty settings path", { SUITE_SETTINGS_DB: "" }, "SUITE_SETTINGS_DB"],
    ["an empty attachment path", { SUITE_ATTACHMENTS_DB: "" }, "SUITE_ATTACHMENTS_DB"],
    [
      "attachments sharing the document file",
      { SUITE_DB: "same.sqlite", SUITE_ATTACHMENTS_DB: "same.sqlite" },
      "SUITE_ATTACHMENTS_DB",
    ],
    ["a short admin token", { SUITE_ADMIN_TOKEN: "too-short" }, "SUITE_ADMIN_TOKEN"],
    [
      "a token with a space",
      { SUITE_ADMIN_TOKEN: "two words that are long enough" },
      "SUITE_ADMIN_TOKEN",
    ],
    ["a short projection token", { SUITE_PROJECTION_TOKEN: "tok" }, "SUITE_PROJECTION_TOKEN"],
    ["a malformed hosted switch", { SUITE_HOSTED: "yes" }, "SUITE_HOSTED"],
    ["a malformed trust-proxy switch", { SUITE_TRUST_PROXY: "true" }, "SUITE_TRUST_PROXY"],
    [
      "an origin with a path",
      { SUITE_ALLOWED_ORIGINS: "https://example.com/app" },
      "SUITE_ALLOWED_ORIGINS",
    ],
    [
      "an origin with a bad scheme",
      { SUITE_ALLOWED_ORIGINS: "ftp://example.com" },
      "SUITE_ALLOWED_ORIGINS",
    ],
    ["an unknown log level", { SUITE_LOG_LEVEL: "verbose" }, "SUITE_LOG_LEVEL"],
    [
      "an unusable licence key",
      { SUITE_LICENCE_PUBLIC_KEY: "not-a-key" },
      "SUITE_LICENCE_PUBLIC_KEY",
    ],
    ["a negative rate limit", { SUITE_CLAIM_RATE_LIMIT: "-1" }, "SUITE_CLAIM_RATE_LIMIT"],
    [
      "a non-numeric publish rate limit",
      { SUITE_PUBLISH_RATE_LIMIT: "20/min" },
      "SUITE_PUBLISH_RATE_LIMIT",
    ],
    ["a non-numeric workspace quota", { SUITE_MAX_WORKSPACES: "lots" }, "SUITE_MAX_WORKSPACES"],
    ["a malformed public URL", { SUITE_PUBLIC_URL: "not a url" }, "SUITE_PUBLIC_URL"],
    ["a version with a space", { SUITE_VERSION: "one two" }, "SUITE_VERSION"],
  ];

  it.each(invalid)("refuses %s", (_label, env, variable) => {
    const result = validateConfig(env);

    expect(result.ok).toBe(false);
    expect(variables(env)).toContain(variable);
    const problem = result.problems.find((entry) => entry.variable === variable);
    expect(problem?.message.length).toBeGreaterThan(0);
    expect(problem?.message).toContain(variable);
  });

  it("refuses a disk soft watermark above the hard one", () => {
    const result = validateConfig({ SUITE_DISK_SOFT_BYTES: "4096", SUITE_DISK_HARD_BYTES: "1024" });

    expect(result.ok).toBe(false);
    const problem = result.problems.find((entry) => entry.variable === "limits");
    expect(problem?.message).toContain("soft");
    expect(problem?.message).toContain("hard");
  });

  it("requires a licence key when hosted, and accepts a real one", () => {
    const missing = validateConfig({ SUITE_HOSTED: "1" });
    expect(missing.ok).toBe(false);
    expect(variables({ SUITE_HOSTED: "1" })).toContain("SUITE_LICENCE_PUBLIC_KEY");

    const pem = licencePublicKeyPem();
    const accepted = validateConfig({ SUITE_HOSTED: "1", SUITE_LICENCE_PUBLIC_KEY: pem });
    expect(accepted.problems).toEqual([]);
    expect(accepted.ok).toBe(true);
    expect(accepted.config.hosted).toBe(true);
    expect(accepted.config.licencePublicKey).toBe(pem.trim());
    expect(accepted.config.limits.diskSoftBytes).toBeGreaterThan(0);
  });

  it("never repeats a token value in a problem", () => {
    const token = `short-${"x".repeat(3)}`;
    const result = validateConfig({ SUITE_ADMIN_TOKEN: token, SUITE_SOURCE_TOKEN: token });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.problems)).not.toContain(token);
  });

  it("treats an unset admin token as off rather than broken", () => {
    const result = validateConfig({ SUITE_ADMIN_TOKEN: "" });
    expect(result.ok).toBe(true);
    expect(result.config.tokens.admin).toBeNull();
    expect(result.config.allowedOrigins).toEqual(["*"]);
  });
});

describe("version stamp", () => {
  it("reads package.json when SUITE_VERSION is unset", () => {
    expect(packageVersion()).toBe(packageJson.version);
    expect(serverVersion({})).toBe(packageJson.version);
    expect(validateConfig({}).config.version).toBe(packageJson.version);
  });

  it("prefers SUITE_VERSION, so an image can carry its tag", () => {
    expect(serverVersion({ SUITE_VERSION: "v1.4.0-rc.1" })).toBe("v1.4.0-rc.1");
  });
});
