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
    expect(readStoredTheme(storage)).toBe("system");
    expect(readStoredTheme(undefined)).toBe("system");
  });

  it("should read a stored mode", () => {
    const storage = { getItem: () => "dark" };
    expect(readStoredTheme(storage)).toBe("dark");
  });

  it("should validate theme modes", () => {
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("midnight")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });
});
