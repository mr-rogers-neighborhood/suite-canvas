import type { WorkspaceTheme } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { applyWorkspaceTheme, themeDeclarations, themedRoles } from "./workspaceTheme";

const theme: WorkspaceTheme = {
  light: { surface: "#fdf6e3", ink: "#201c14", canvas: "#f5f0e1" },
  dark: { surface: "#1c1c1e" },
};

describe("a workspace's palette", () => {
  it("resolves a role to the token every surface already reads", () => {
    expect(themeDeclarations(theme, "light")).toEqual([
      { token: "--surface", value: "#fdf6e3" },
      { token: "--ink", value: "#201c14" },
      { token: "--canvas-bg", value: "#f5f0e1" },
    ]);
  });

  it("is per mode, which is what keeps the visitor's brightness", () => {
    expect(themeDeclarations(theme, "dark")).toEqual([{ token: "--surface", value: "#1c1c1e" }]);
    // A role the theme does not name in that mode keeps the built-in token.
    expect(themeDeclarations(theme, "dark").map((entry) => entry.token)).not.toContain("--ink");
  });

  it("names nothing when there is no theme", () => {
    expect(themeDeclarations(undefined, "light")).toEqual([]);
    expect(themedRoles(undefined, "light")).toEqual([]);
    expect(themedRoles(theme, "light")).toEqual(["surface", "ink", "canvas"]);
  });

  it("clears every token it wrote before painting the next set", () => {
    const root = document.createElement("div");
    const applied = new Set<string>();

    applyWorkspaceTheme(root, theme, "light", applied);
    expect(root.style.getPropertyValue("--ink")).toBe("#201c14");

    // Switching to dark drops the tokens dark does not name: a canvas painted from
    // a light palette must not survive into a dark one.
    applyWorkspaceTheme(root, theme, "dark", applied);
    expect(root.style.getPropertyValue("--surface")).toBe("#1c1c1e");
    expect(root.style.getPropertyValue("--ink")).toBe("");
    expect(root.style.getPropertyValue("--canvas-bg")).toBe("");

    applyWorkspaceTheme(root, undefined, "dark", applied);
    expect(root.style.getPropertyValue("--surface")).toBe("");
    expect(applied.size).toBe(0);
  });
});
