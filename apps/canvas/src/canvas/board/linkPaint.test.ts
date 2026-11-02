import { DEFAULT_PALETTE } from "@suite/graph";
import { describe, expect, it } from "vitest";
import type { EdgeDescriptionData } from "../EdgeDescription";
import { toFlowEdge } from "./boardSupport";

/**
 * What a link paints.
 *
 * Three states used to look wrong in the same way, and the reader reported them as one: a link with a swatch the palette has
 * lost painted the theme's accent blue; a link that had never been styled painted nothing at all, so it fell through to
 * React Flow's default grey; and a coloured link kept a theme-coloured arrowhead because the marker only ever took a
 * presence colour. Each case below is one of those.
 */
const data: Pick<EdgeDescriptionData, "onLabelDrag" | "onLabelEdit"> = {
  onLabelDrag: () => {},
  onLabelEdit: () => {},
};

const AMBER = DEFAULT_PALETTE.find((entry) => entry.id === "amber")?.light ?? "#f59e0b";

function link(style: Record<string, unknown> | undefined) {
  return {
    id: "e1",
    boardId: "b1",
    source: "c1",
    target: "c2",
    path: "bezier",
    createdAt: 1,
    ...(style === undefined ? {} : { style }),
  } as never;
}

describe("the stroke a link paints", () => {
  it("should paint the colour its swatch resolves to", () => {
    const painted = toFlowEdge(
      link({ swatch: "amber" }),
      { source: "n1", target: "n2" },
      false,
      data,
      undefined,
      AMBER,
    );
    expect(painted.style?.stroke).toBe(AMBER);
  });

  /**
   * The fallback, and the reason it is worth knowing about: a swatch that has been renamed or deleted resolves to
   * nothing, and the link wears the theme's link colour rather than disappearing. The panel is what says the colour is
   * gone; the line stays a line.
   */
  it("should fall back to the theme's link colour when the swatch names nothing", () => {
    const painted = toFlowEdge(
      link({ swatch: "renamed" }),
      { source: "n1", target: "n2" },
      false,
      data,
      undefined,
      null,
    );
    expect(painted.style?.stroke).toBe("var(--accent)");
  });

  it("should paint the theme's link colour on a link nobody has styled", () => {
    const painted = toFlowEdge(link(undefined), { source: "n1", target: "n2" }, false, data);
    // No stroke at all used to fall through to React Flow's own default, which is not our colour and not our width.
    expect(painted.style?.stroke).toBe("var(--accent)");
  });

  it("should colour the arrowhead to match the line", () => {
    const painted = toFlowEdge(
      link({ swatch: "amber" }),
      { source: "n1", target: "n2" },
      false,
      data,
      undefined,
      AMBER,
    );
    expect(painted.markerEnd).toMatchObject({ color: AMBER });
  });

  it("should let a peer's colour win, arrowhead included, while their hand is on it", () => {
    const painted = toFlowEdge(
      link({ swatch: "amber" }),
      { source: "n1", target: "n2" },
      false,
      data,
      "#ff00ff",
      AMBER,
    );
    expect(painted.style?.stroke).toBe("#ff00ff");
    expect(painted.markerEnd).toMatchObject({ color: "#ff00ff" });
  });
});
