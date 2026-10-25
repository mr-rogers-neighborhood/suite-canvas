import type { GraphEdge } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { linkRoutePath, type SectionLink, sectionLinkPath } from "./SectionLinkLayer";

/** Only the fields the route reads: path, bends and the id the pair rule hashes. */
function edge(id: string, extra: Record<string, unknown> = {}): GraphEdge {
  return {
    id,
    boardId: "board-1",
    source: "section-1",
    target: "card-b",
    kind: "references",
    path: "bezier",
    bidirectional: false,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  } as unknown as GraphEdge;
}

const anchors = { source: { x: 100, y: 100 }, target: { x: 400, y: 300 } };

const link = (withEdge: GraphEdge): SectionLink => ({ edge: withEdge, anchors, offLens: false });

describe("a section link's route", () => {
  it("keeps the fixed curve when it has neither bends nor a twin", () => {
    const drawn = linkRoutePath(link(edge("e-1")), [edge("e-1")]);
    expect(drawn).toBe(sectionLinkPath(anchors));
    // Two cubic segments is what the fixed curve is: one C command.
    expect(drawn.match(/C/g) ?? []).toHaveLength(1);
  });

  it("draws its bends, so a bent section link is the same shape as a bent card link", () => {
    const bent = linkRoutePath(link(edge("e-1", { bends: [{ x: 80, y: -60 }] })), []);
    expect(bent).toContain("180");
    expect(bent).toContain("40");
    expect(bent).not.toBe(linkRoutePath(link(edge("e-1")), []));
  });

  it("follows the same mode as a card link", () => {
    const straight = linkRoutePath(
      link(edge("e-1", { path: "straight", bends: [{ x: 80, y: -60 }] })),
      [],
    );
    expect(straight).not.toContain("C");
    const stepped = linkRoutePath(
      link(edge("e-1", { path: "smoothstep", bends: [{ x: 80, y: -60 }] })),
      [],
    );
    expect(stepped).toContain("Q");
  });

  it("falls back to the curve in `avoid`: this layer cannot see the board's frames", () => {
    const drawn = linkRoutePath(link(edge("e-1", { path: "avoid" })), []);
    expect(drawn.match(/C/g) ?? []).toHaveLength(1);
  });

  it("separates a reverse pair without moving a lone link", () => {
    const out = edge("e-out", {
      source: "card-a",
      target: "card-b",
      sourceConnector: "dot-1",
      targetConnector: "dot-2",
    });
    const back = edge("e-back", {
      source: "card-b",
      target: "card-a",
      sourceConnector: "dot-2",
      targetConnector: "dot-1",
    });
    const pair = [out, back];
    const forward = linkRoutePath({ edge: out, anchors, offLens: false }, pair);
    const backward = linkRoutePath(
      { edge: back, anchors: { source: anchors.target, target: anchors.source }, offLens: false },
      pair,
    );
    expect(forward).not.toBe(backward);
    // Deterministic: the same document always draws the same pair.
    expect(linkRoutePath({ edge: out, anchors, offLens: false }, pair)).toBe(forward);
    // A lone link is untouched, exactly as it drew before ADR-0052.
    expect(linkRoutePath({ edge: out, anchors, offLens: false }, [out])).toBe(
      linkRoutePath(link(edge("e-other")), []),
    );
  });
});
