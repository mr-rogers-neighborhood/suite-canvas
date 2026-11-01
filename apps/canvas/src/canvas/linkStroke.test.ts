import { DEFAULT_PALETTE, resolveSurfaceStyle, WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { swatchOf } from "./surfaceContext";
import { linkStroke } from "./surfacePaint";

/**
 * The colour a link paints with.
 *
 * A link's colour is stored as a **swatch**, and its stroke was painted from an ink *role*, so picking a colour in the
 * right-click menu changed nothing and a link that lost its swatch looked exactly like one that never had one: both were
 * the accent. These are the two halves of the fix — the resolver, and the stroke that consumes it.
 */
function style(patch: Parameters<typeof resolveSurfaceStyle>[0] = {}) {
  return resolveSurfaceStyle(patch, "link");
}

const CONTEXT = { palette: DEFAULT_PALETTE, roles: {}, mode: "light" as const };

describe("a link's stroke", () => {
  it("should paint the swatch's colour when it names one", () => {
    const swatch = swatchOf({ swatch: "rose" }, CONTEXT);
    expect(swatch).not.toBeNull();

    const stroke = linkStroke(style({ ink: "ink" }), swatch?.colour ?? null);

    const rose = DEFAULT_PALETTE.find((entry) => entry.id === "rose");
    expect(stroke.stroke).toBe(rose?.light);
  });

  it("should fall back to the theme's link colour when it names none", () => {
    // Unset is what "no colour chosen" means, so an unstyled link must look exactly as it always did.
    const stroke = linkStroke(style({}), null);
    expect(stroke.stroke).toBe("var(--accent)");
  });

  it("should fall back when the swatch no longer names a palette entry", () => {
    // A deleted swatch is not a colour: painting nothing would leave the link invisible.
    expect(swatchOf({ swatch: "not-in-the-palette" }, CONTEXT)).toBeNull();
    expect(linkStroke(style({}), null).stroke).toBe("var(--accent)");
  });

  it("should keep painting its width and dash, which are the same stroke", () => {
    const stroke = linkStroke(style({ sides: { top: { paint: "dashed", width: 3 } } }), null);
    expect(stroke.strokeWidth).toBe(3);
    expect(stroke.strokeDasharray).toBe("7 5");
  });
});

/**
 * The sequence the owner reported: colour a link, then change something else on it, and it turned blue.
 *
 * It is a property of the writer rather than of the painter: every `setEdgeStyle` call has to spread the style it is
 * changing, and one that writes a fresh object drops the swatch. This pins the document's behaviour so a future writer
 * cannot reintroduce it silently.
 */
describe("changing one thing about a link", () => {
  it("should keep the colour when another option changes", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    const a = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const b = workspace.createCard({ boardId: board.id, position: { x: 200, y: 0 } });
    const edge = workspace.addEdge({ boardId: board.id, source: a.id, target: b.id });

    if (edge === null) throw new Error("no edge");
    workspace.setEdgeStyle(edge.id, { swatch: "rose" });
    const styled = workspace.getEdge(edge.id)?.style;
    expect(styled?.swatch).toBe("rose");

    // A line-style write, spread from what is there: the colour survives.
    workspace.setEdgeStyle(edge.id, {
      ...styled,
      sides: { ...styled?.sides, top: { paint: "dashed" } },
    });

    const after = workspace.getEdge(edge.id)?.style;
    expect(after?.swatch).toBe("rose");
    expect(after?.sides?.top?.paint).toBe("dashed");
  });
});
