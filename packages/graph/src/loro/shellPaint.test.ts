import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function workspace() {
  const doc = new WorkspaceDocument();
  const board = doc.createBoard({ name: "Paint" });
  return { doc, board };
}

describe("the workspace's own paint", () => {
  it("stores the shell's style and reads it back", () => {
    const { doc } = workspace();
    expect(doc.shellStyle()).toBeUndefined();

    doc.setShellStyle({ surface: "surface-strong", ink: "ink", radius: 12 });

    expect(doc.shellStyle()).toEqual({ surface: "surface-strong", ink: "ink", radius: 12 });
  });

  it("drops a shell style that says nothing, and clears on null", () => {
    const { doc } = workspace();
    doc.setShellStyle({ radius: 8 });
    expect(doc.shellStyle()).toBeDefined();
    doc.setShellStyle({});
    expect(doc.shellStyle()).toBeUndefined();

    doc.setShellStyle({ ink: "accent" });
    doc.setShellStyle(null);
    expect(doc.shellStyle()).toBeUndefined();
  });

  it("refuses a shell colour stored as a value rather than a role", () => {
    const { doc } = workspace();
    expect(() => doc.setShellStyle({ surface: "#ffffff" } as never)).toThrow();
    expect(doc.shellStyle()).toBeUndefined();
  });

  it("stores named rules in order, on the document", () => {
    const { doc } = workspace();
    doc.setStyleRules([
      {
        id: "notes-are-strong",
        name: "Notes are strong",
        order: 1,
        scope: { kind: "type", id: "note" },
        style: { surface: "surface-strong" },
      },
      {
        id: "everywhere",
        name: "Everywhere",
        order: 0,
        scope: { kind: "global" },
        style: { textScale: 1.1 },
      },
    ]);

    const rules = doc.styleRules();
    expect(rules.map((rule) => rule.id)).toEqual(["everywhere", "notes-are-strong"]);

    // On the document, so a collaborator reads the same rules; the stored array
    // keeps write order and every reader sorts by `order`.
    const meta = doc.toJSON().meta as { rules?: Array<{ id: string }> } | undefined;
    expect(meta?.rules?.map((rule) => rule.id)).toEqual(["notes-are-strong", "everywhere"]);

    doc.setStyleRules([]);
    expect(doc.styleRules()).toEqual([]);
  });

  it("notifies its own readers when the paint changes, and only then", () => {
    const { doc, board } = workspace();
    let calls = 0;
    const stop = doc.observeWorkspacePaint(() => {
      calls += 1;
    });

    doc.setShellStyle({ ink: "accent" });
    expect(calls).toBe(1);

    doc.setStyleRules([
      {
        id: "everywhere",
        name: "Everywhere",
        order: 0,
        scope: { kind: "global" },
        style: { textScale: 1.1 },
      },
    ]);
    expect(calls).toBe(2);

    // A card edit is a snapshot change, not a paint change.
    doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    expect(calls).toBe(2);

    stop();
    doc.setShellStyle(null);
    expect(calls).toBe(2);
  });

  it("ignores a rule whose scope no surface could ever match", () => {
    const { doc } = workspace();
    expect(() =>
      doc.setStyleRules([
        {
          id: "broken",
          name: "Broken",
          order: 0,
          scope: { kind: "nonsense", id: "note" } as never,
          style: {},
        },
      ]),
    ).toThrow();
  });
});
