import { describe, expect, it } from "vitest";
import {
  LIMIT_OVERRIDES_KEY,
  readLimitOverrides,
  resolveLimits,
  writeLimitOverrides,
} from "../config/limits.js";
import { createSettingsStore, SETTINGS_DB_ENV, settingsPath } from "./settings.js";

describe("settings store", () => {
  it("round-trips values, overwrites and deletes", () => {
    const store = createSettingsStore();
    try {
      expect(store.get("limits.overrides")).toBeNull();

      store.set("limits.overrides", '{"maxWorkspaces":3}');
      expect(store.get("limits.overrides")).toBe('{"maxWorkspaces":3}');

      store.set("limits.overrides", '{"maxWorkspaces":4}');
      expect(store.get("limits.overrides")).toBe('{"maxWorkspaces":4}');

      store.set("limits.overrides", null);
      expect(store.get("limits.overrides")).toBeNull();
      expect(store.all()).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("lists every row with its write time", () => {
    const store = createSettingsStore();
    try {
      store.set("b", "2");
      store.set("a", "1");

      expect(store.all().map((row) => [row.key, row.value])).toEqual([
        ["a", "1"],
        ["b", "2"],
      ]);
      expect(store.updatedAt("a")).toBeGreaterThan(0);
      expect(store.updatedAt("missing")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("keeps two stores isolated", () => {
    const left = createSettingsStore();
    const right = createSettingsStore();
    try {
      left.set("limits.overrides", '{"maxWorkspaces":3}');
      expect(right.get("limits.overrides")).toBeNull();
      expect(right.all()).toEqual([]);
    } finally {
      left.close();
      right.close();
    }
  });

  it("rejects an empty key", () => {
    const store = createSettingsStore();
    try {
      expect(() => store.set("  ", "x")).toThrowError(/settings key is required/);
    } finally {
      store.close();
    }
  });

  it("defaults to in-memory and reads SUITE_SETTINGS_DB when set", () => {
    expect(settingsPath({})).toBe(":memory:");
    expect(settingsPath({ [SETTINGS_DB_ENV]: "   " })).toBe(":memory:");
    expect(settingsPath({ [SETTINGS_DB_ENV]: "/data/suite.settings.sqlite" })).toBe(
      "/data/suite.settings.sqlite",
    );
  });

  it("drives the effective limits through the overrides key", () => {
    const store = createSettingsStore();
    try {
      const before = resolveLimits({ SUITE_MAX_WORKSPACES: "10" }, readLimitOverrides(store));
      expect(before.limits.maxWorkspaces).toBe(10);
      expect(before.sources.maxWorkspaces).toBe("env");

      writeLimitOverrides(store, { maxWorkspaces: 2 });
      expect(store.get(LIMIT_OVERRIDES_KEY)).toBe('{"maxWorkspaces":2}');

      const after = resolveLimits({ SUITE_MAX_WORKSPACES: "10" }, readLimitOverrides(store));
      expect(after.limits.maxWorkspaces).toBe(2);
      expect(after.sources.maxWorkspaces).toBe("override");
    } finally {
      store.close();
    }
  });
});
