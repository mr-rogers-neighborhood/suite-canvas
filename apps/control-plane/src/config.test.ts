import { describe, expect, it } from "vitest";
import {
  buildIdOf,
  DATABASE_MODULES,
  DATABASE_URL_VARIABLE,
  DEFAULT_PORT,
  packageVersion,
  validateConfig,
} from "./config.js";

describe("control plane port", () => {
  it("should default to 1236", () => {
    const result = validateConfig({});

    expect(DEFAULT_PORT).toBe(1236);
    expect(result.ok).toBe(true);
    expect(result.config.port).toBe(1236);
  });

  it("should read PORT", () => {
    expect(validateConfig({ PORT: "8080" }).config.port).toBe(8080);
  });

  it("should name PORT when it is not a port", () => {
    const result = validateConfig({ PORT: "eighty" });

    expect(result.ok).toBe(false);
    expect(result.problems[0]?.variable).toBe("PORT");
    expect(result.config.port).toBe(DEFAULT_PORT);
  });

  it("should refuse a port outside the range", () => {
    for (const value of ["0", "65536", "-1"]) {
      const result = validateConfig({ PORT: value });
      expect(result.ok, value).toBe(false);
      expect(result.problems[0]?.variable).toBe("PORT");
    }
  });
});

describe("control plane database", () => {
  it("should not require a connection string while no module is mounted", () => {
    const result = validateConfig({});

    expect(result.ok).toBe(true);
    expect(result.config.databaseUrl).toBeNull();
    expect(DATABASE_MODULES).toEqual(["auth", "billing", "admin"]);
  });

  it("should refuse to start when a Postgres module is mounted without a URL", () => {
    for (const name of DATABASE_MODULES) {
      const result = validateConfig({}, [name]);

      expect(result.ok, name).toBe(false);
      expect(result.problems[0]?.variable).toBe(DATABASE_URL_VARIABLE);
      expect(result.problems[0]?.message).toContain(name);
    }
  });

  it("should start a mounted module once the URL is set", () => {
    const result = validateConfig(
      { [DATABASE_URL_VARIABLE]: "postgres://suite:suite@postgres:5432/suite" },
      ["auth"],
    );

    expect(result.ok).toBe(true);
    expect(result.config.databaseUrl).toBe("postgres://suite:suite@postgres:5432/suite");
  });

  it("should name the variable when the value is not a Postgres URL", () => {
    const result = validateConfig({ [DATABASE_URL_VARIABLE]: "mysql://nope" }, ["auth"]);

    expect(result.ok).toBe(false);
    expect(result.problems[0]?.variable).toBe(DATABASE_URL_VARIABLE);
    expect(result.problems[0]?.message).not.toContain("mysql://nope");
  });
});

describe("SUITE_AUTH_* passthrough", () => {
  it("should collect every non-empty account variable and nothing else", () => {
    const result = validateConfig({
      SUITE_AUTH_ENABLED: "1",
      SUITE_AUTH_URL: " https://accounts.example.com ",
      SUITE_AUTH_SECRET: "   ",
      SUITE_GOOGLE_CLIENT_ID: "google-id",
      SUITE_BILLING_ENABLED: "1",
      STRIPE_SECRET_KEY: "sk_test",
    });

    expect(result.config.auth).toEqual({
      SUITE_AUTH_ENABLED: "1",
      SUITE_AUTH_URL: "https://accounts.example.com",
    });
  });
});

describe("control plane log level", () => {
  it("should default to info", () => {
    expect(validateConfig({}).config.logLevel).toBe("info");
  });

  it("should accept a level in any case", () => {
    expect(validateConfig({ SUITE_LOG_LEVEL: "DEBUG" }).config.logLevel).toBe("debug");
  });

  it("should name SUITE_LOG_LEVEL and fall back to info when it is not a level", () => {
    const result = validateConfig({ SUITE_LOG_LEVEL: "verbose" });

    expect(result.ok).toBe(false);
    expect(result.problems[0]?.variable).toBe("SUITE_LOG_LEVEL");
    expect(result.config.logLevel).toBe("info");
  });
});

describe("control plane build id", () => {
  it("should prefer SUITE_VERSION", () => {
    expect(buildIdOf({ SUITE_VERSION: " 9.9.9 " })).toBe("9.9.9");
  });

  it("should fall back to this package's version", () => {
    expect(buildIdOf({})).toBe(packageVersion());
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/u);
  });
});
