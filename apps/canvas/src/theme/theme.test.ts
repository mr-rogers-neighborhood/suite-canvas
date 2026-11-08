import { describe, expect, it } from "vitest";
import { isThemeMode, readStoredTheme, resolveTheme, THEME_STORAGE_KEY } from "./theme";

describe("theme", () => {
  it("should resolve system mode from the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("should keep explicit modes regardless of the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("should fall back to system for missing or invalid storage", () => {
    const storage = { getItem: (key: string) => (key === THEME_STORAGE_KEY ? "neon" : null) };
    expect(readStoredTheme(storage)).toEqual({ preset: "suite", mode: "system" });
    expect(readStoredTheme(undefined)).toEqual({ preset: "suite", mode: "system" });
  });

  it("should read the pair a choice is stored as", () => {
    const storage = { getItem: () => JSON.stringify({ preset: "solarized", mode: "dark" }) };
    expect(readStoredTheme(storage)).toEqual({ preset: "solarized", mode: "dark" });
  });

  it("should keep a mode written before presets existed", () => {
    // The record used to be a bare string. Someone who chose dark should not lose it
    // because the file grew a field.
    const storage = { getItem: () => "dark" };
    expect(readStoredTheme(storage)).toEqual({ preset: "suite", mode: "dark" });
  });

  it("should fall back for a preset this build does not ship", () => {
    const storage = { getItem: () => JSON.stringify({ preset: "neon", mode: "light" }) };
    expect(readStoredTheme(storage)).toEqual({ preset: "suite", mode: "light" });
  });

  it("should validate theme modes", () => {
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("midnight")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });
});
