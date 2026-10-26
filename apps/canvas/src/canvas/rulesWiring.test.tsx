import type { Card, CardType, StyleRule } from "@suite/graph";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { NodeCard } from "../cards/NodeCard";
import { type SurfaceRules, SurfaceRulesContext } from "./rules";

/**
 * The rule layer reaches a card through the provider the shell installs
 * (ADR-0046 §3–4). Cards are the only surface wired today; the same provider
 * will carry sections, boards and the shell regions.
 */

const doc = new LoroDoc();
const contentId = doc.getMap("content").ensureMergeableMap("n1").id;
const titleId = doc.getMap("titles").ensureMergeableMap("n1").id;

const card: Card = {
  id: "n1",
  createdAt: 0,
  updatedAt: 0,
  connectors: [
    { id: "c-top", x: 0.5, y: 0 },
    { id: "c-right", x: 1, y: 0.5 },
    { id: "c-bottom", x: 0.5, y: 1 },
    { id: "c-left", x: 0, y: 0.5 },
  ],
  typeIds: ["note"],
  primaryTypeId: "note",
  tags: [],
  properties: {},
};

const type: CardType = {
  id: "note",
  name: "Note",
  glyph: "\u25a1",
  createdAt: 0,
  updatedAt: 0,
  fields: [],
};

function renderCard(rules: SurfaceRules) {
  return render(
    <ReactFlowProvider>
      <SurfaceRulesContext.Provider value={rules}>
        <NodeCard
          card={card}
          type={type}
          meta={{ properties: [], tags: [] }}
          cardDoc={doc}
          contentId={contentId}
          titleId={titleId}
          cursorStore={null}
          localUser={null}
          boardId="board-1"
        />
      </SurfaceRulesContext.Provider>
    </ReactFlowProvider>,
  );
}

const noteRule: StyleRule = {
  id: "notes",
  name: "Notes",
  order: 0,
  scope: { kind: "type", id: "note" },
  style: { surface: "surface-strong", radius: 14 },
};

describe("a card painted by a rule", () => {
  it("should paint only when a rule or the card's own style names it", () => {
    renderCard({ rules: [], palette: {} });
    const plain = screen.getByTestId("node-card");
    expect(plain.className).not.toContain("is-painted");
    expect(plain.getAttribute("style") ?? "").not.toContain("--paint-surface");
  });

  it("should paint a card its type rule names through the shared variables", () => {
    renderCard({ rules: [noteRule], palette: {} });
    const painted = screen.getByTestId("node-card");
    expect(painted.className).toContain("is-painted");
    expect(painted.getAttribute("style")).toContain("--paint-surface: var(--surface-strong)");
    expect(painted.getAttribute("style")).toContain("--paint-radius: 14px");
  });
});
