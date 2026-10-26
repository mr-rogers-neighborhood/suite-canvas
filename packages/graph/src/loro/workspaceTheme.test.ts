import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function workspace() {
  return new WorkspaceDocument();
}

/**
 * ADR-0071 Q2–Q3: a workspace can carry its own palette, per mode, as document
 * data — which is what lets a share render the author's colours while the
 * visitor's light/dark choice still works.
 */
describe("the workspace palette", () => {
  it("starts absent, so a workspace without one is unchanged", () => {
    expect(workspace().workspaceTheme()).toBeUndefined();
  });

  it("stores a value per role and per mode", () => {
    const doc = workspace();
    doc.setWorkspaceTheme({
      light: { surface: "#fdf6e3", canvas: "#f5f0e1" },
      dark: { surface: "#1c1c1e" },
    });

    expect(doc.workspaceTheme()).toEqual({
      light: { canvas: "#f5f0e1", surface: "#fdf6e3" },
      dark: { surface: "#1c1c1e" },
    });
  });

  it("refuses a role the vocabulary does not name", () => {
    const doc = workspace();
    expect(() =>
      doc.setWorkspaceTheme({ light: { "not-a-role": "#fff" }, dark: {} } as never),
    ).toThrow();
    expect(doc.workspaceTheme()).toBeUndefined();
  });

  it("drops an empty palette instead of storing it", () => {
    const doc = workspace();
    doc.setWorkspaceTheme({ light: { accent: "#123456" }, dark: {} });
    expect(doc.workspaceTheme()).toBeDefined();

    doc.setWorkspaceTheme({ light: {}, dark: {} });
    expect(doc.workspaceTheme()).toBeUndefined();

    doc.setWorkspaceTheme({ light: { accent: "#123456" }, dark: {} });
    doc.setWorkspaceTheme(null);
    expect(doc.workspaceTheme()).toBeUndefined();
  });

  it("reaches a collaborator, which is the point of storing it here", () => {
    const doc = workspace();
    const peer = new WorkspaceDocument();
    doc.setWorkspaceTheme({ light: { ink: "#101010" }, dark: {} });

    // The palette travels in the same document as everything else: a snapshot of
    // the author's doc is a snapshot of their colours.
    const snapshot = doc.doc.export({ mode: "snapshot" });
    peer.doc.import(snapshot);

    expect(peer.workspaceTheme()?.light.ink).toBe("#101010");
  });
});
