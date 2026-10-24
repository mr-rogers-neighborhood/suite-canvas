import { describe, expect, it, vi } from "vitest";
import {
  applyEdgeLabelWrite,
  type EdgeLabelWriter,
  ICE_EDIT_CAPABILITIES,
  ICE_VIEW_CAPABILITIES,
  normaliseEdgeLabel,
  planConnectorMove,
  planEdgeDelete,
  planEdgeLabel,
} from "./iceBridge";

const WRITER = { capabilities: ICE_EDIT_CAPABILITIES };
const VIEWER = { capabilities: ICE_VIEW_CAPABILITIES };

/** A document door that records what it was asked to write. */
function makeWriter() {
  return { setEdgeLabel: vi.fn(), moveConnector: vi.fn(), removeEdge: vi.fn() };
}

describe("planEdgeLabel", () => {
  it("should commit one trimmed write for a new description", () => {
    const plan = planEdgeLabel(
      { kind: "edge-label", edgeId: "edge-1", label: "  supports  ", current: null },
      WRITER,
    );
    expect(plan).toEqual({
      status: "commit",
      write: { kind: "setEdgeLabel", edgeId: "edge-1", label: "supports" },
    });
  });

  it("should write nothing when the description is unchanged", () => {
    expect(
      planEdgeLabel(
        { kind: "edge-label", edgeId: "edge-1", label: "supports", current: "supports" },
        WRITER,
      ),
    ).toEqual({ status: "skip", reason: "no-change" });
    // Padding is not a change either: the document trims, so the plan must.
    expect(
      planEdgeLabel(
        { kind: "edge-label", edgeId: "edge-1", label: "  supports ", current: "supports" },
        WRITER,
      ),
    ).toEqual({ status: "skip", reason: "no-change" });
    expect(
      planEdgeLabel({ kind: "edge-label", edgeId: "edge-1", label: "  ", current: null }, WRITER),
    ).toEqual({ status: "skip", reason: "no-change" });
  });

  it("should clear a description by writing null, not an empty string", () => {
    const plan = planEdgeLabel(
      { kind: "edge-label", edgeId: "edge-1", label: "   ", current: "supports" },
      WRITER,
    );
    expect(plan).toEqual({
      status: "commit",
      write: { kind: "setEdgeLabel", edgeId: "edge-1", label: null },
    });
  });

  it("should refuse a write for a seat that may not write, and a nameless edge", () => {
    expect(
      planEdgeLabel({ kind: "edge-label", edgeId: "edge-1", label: "x", current: null }, VIEWER),
    ).toEqual({ status: "denied", reason: "read-only" });
    expect(
      planEdgeLabel({ kind: "edge-label", edgeId: "", label: "x", current: null }, WRITER),
    ).toEqual({ status: "skip", reason: "no-instance" });
  });

  it("should land as exactly one setEdgeLabel", () => {
    const writer = makeWriter();
    const plan = planEdgeLabel(
      { kind: "edge-label", edgeId: "edge-1", label: "see also", current: null },
      WRITER,
    );
    if (plan.status !== "commit") throw new Error("expected a commit");
    applyEdgeLabelWrite(writer as unknown as EdgeLabelWriter, plan.write);
    expect(writer.setEdgeLabel).toHaveBeenCalledTimes(1);
    expect(writer.setEdgeLabel).toHaveBeenCalledWith("edge-1", "see also");
  });

  it("should treat an empty string as no description at all", () => {
    expect(normaliseEdgeLabel("")).toBeNull();
    expect(normaliseEdgeLabel(undefined)).toBeNull();
    expect(normaliseEdgeLabel(" a ")).toBe("a");
  });
});

describe("planEdgeDelete", () => {
  it("should remove every selected link in one write", () => {
    expect(
      planEdgeDelete({ kind: "edge-delete", edgeIds: ["edge-1", "edge-1", "edge-2"] }, WRITER),
    ).toEqual({
      status: "commit",
      write: { kind: "removeEdges", edgeIds: ["edge-1", "edge-2"] },
    });
  });

  it("should write nothing for an empty selection", () => {
    expect(planEdgeDelete({ kind: "edge-delete", edgeIds: [] }, WRITER)).toEqual({
      status: "skip",
      reason: "empty-selection",
    });
  });

  it("should refuse a viewer", () => {
    expect(planEdgeDelete({ kind: "edge-delete", edgeIds: ["edge-1"] }, VIEWER)).toEqual({
      status: "denied",
      reason: "read-only",
    });
  });
});

describe("planConnectorMove", () => {
  it("should clamp a drag onto the card's own fractions", () => {
    expect(
      planConnectorMove(
        {
          kind: "connector-move",
          cardId: "card-1",
          connectorId: "connector-1",
          position: { x: 1.4, y: -0.2 },
          current: { x: 0.5, y: 0 },
        },
        WRITER,
      ),
    ).toEqual({
      status: "commit",
      write: {
        kind: "moveConnector",
        cardId: "card-1",
        connectorId: "connector-1",
        position: { x: 1, y: 0 },
      },
    });
  });

  it("should write nothing when the connector did not move", () => {
    expect(
      planConnectorMove(
        {
          kind: "connector-move",
          cardId: "card-1",
          connectorId: "connector-1",
          position: { x: 0.5, y: 0 },
          current: { x: 0.5, y: 0 },
        },
        WRITER,
      ),
    ).toEqual({ status: "skip", reason: "no-change" });
  });

  it("should collapse a non-finite fraction to the middle rather than write NaN", () => {
    const plan = planConnectorMove(
      {
        kind: "connector-move",
        cardId: "card-1",
        connectorId: "connector-1",
        position: { x: Number.NaN, y: 1 },
      },
      WRITER,
    );
    expect(plan).toEqual({
      status: "commit",
      write: {
        kind: "moveConnector",
        cardId: "card-1",
        connectorId: "connector-1",
        position: { x: 0.5, y: 1 },
      },
    });
  });

  it("should refuse a viewer and a nameless connector", () => {
    const intent = {
      kind: "connector-move" as const,
      cardId: "card-1",
      connectorId: "connector-1",
      position: { x: 0.5, y: 0.5 },
    };
    expect(planConnectorMove(intent, VIEWER)).toEqual({ status: "denied", reason: "read-only" });
    expect(planConnectorMove({ ...intent, connectorId: "" }, WRITER)).toEqual({
      status: "skip",
      reason: "no-instance",
    });
  });
});
