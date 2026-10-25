import { describe, expect, it } from "vitest";
import { edgeEndpoints } from "../links.js";
import type { EdgeEndpointKind } from "../schema.js";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

/**
 * Every way a link can be drawn, in one table. A link has two ends; each end is
 * a card, a board or a section; either end may or may not sit on a connector.
 * The one-offs this catches are the ones a hand-written test misses: a session
 * endpoint whose connector is dropped, a kind that only works in one direction,
 * a reconnect that keeps the old kind, a reverse that swaps ids but not kinds.
 */

const kinds: readonly EdgeEndpointKind[] = ["card", "board", "section"];

interface Endpoint {
  kind: EdgeEndpointKind;
  id: string;
  connectors: string[];
}

/**
 * Two things of every kind, so a same-kind pair is two entities rather than a
 * self-link. `endpoint(kind, 0)` and `endpoint(kind, 1)` are interchangeable in
 * every test below.
 */
function fixture() {
  const workspace = new WorkspaceDocument();
  const home = workspace.createBoard({ name: "Home" });
  const openedA = workspace.createBoard({ name: "Opened A" });
  const openedB = workspace.createBoard({ name: "Opened B" });
  const cardA = workspace.createCard({ boardId: home.id, position: { x: 0, y: 0 } });
  const cardB = workspace.createCard({ boardId: home.id, position: { x: 400, y: 0 } });
  const sectionA = workspace.createSection({ boardId: home.id, x: 0, y: 400 });
  const sectionB = workspace.createSection({ boardId: home.id, x: 0, y: 800 });
  // A board has no connectors of its own; a link to one is drawn through the
  // portal that opens it, so the portal's dots are what a caller may pass.
  const portalA = workspace.createPortalCard({ boardId: home.id, targetBoardId: openedA.id });
  const portalB = workspace.createPortalCard({ boardId: home.id, targetBoardId: openedB.id });
  const dotsOf = (entries: readonly { id: string }[]) => entries.map((entry) => entry.id);
  const endpoints: Record<EdgeEndpointKind, [Endpoint, Endpoint]> = {
    card: [
      { kind: "card", id: cardA.id, connectors: dotsOf(cardA.connectors) },
      { kind: "card", id: cardB.id, connectors: dotsOf(cardB.connectors) },
    ],
    board: [
      { kind: "board", id: openedA.id, connectors: dotsOf(portalA.connectors) },
      { kind: "board", id: openedB.id, connectors: dotsOf(portalB.connectors) },
    ],
    section: [
      { kind: "section", id: sectionA.id, connectors: dotsOf(sectionA.connectors ?? []) },
      { kind: "section", id: sectionB.id, connectors: dotsOf(sectionB.connectors ?? []) },
    ],
  };
  const endpoint = (kind: EdgeEndpointKind, index: 0 | 1): Endpoint => {
    const pair = endpoints[kind][index];
    if (!pair) throw new Error(`no ${kind} at ${index}`);
    return pair;
  };
  return { workspace, home, portalA, endpoint };
}

/** The stored edge must record exactly what was asked for, both ends and both dots. */
function expectStored(
  workspace: WorkspaceDocument,
  edgeId: string,
  source: { kind: EdgeEndpointKind; id: string; connector?: string | undefined },
  target: { kind: EdgeEndpointKind; id: string; connector?: string | undefined },
) {
  const edge = workspace.listEdges().find((entry) => entry.id === edgeId);
  if (!edge) throw new Error("edge was not stored");
  expect(edgeEndpoints(edge)).toEqual({
    source: { kind: source.kind, id: source.id },
    target: { kind: target.kind, id: target.id },
  });
  expect(edge.sourceConnector).toBe(source.connector);
  expect(edge.targetConnector).toBe(target.connector);
}

describe("link endpoint matrix", () => {
  for (const sourceKind of kinds) {
    for (const targetKind of kinds) {
      for (const sourceIndex of [null, 0, 1] as const) {
        for (const targetIndex of [null, 0, 1] as const) {
          const label = `${sourceKind}:${sourceIndex ?? "-"} -> ${targetKind}:${targetIndex ?? "-"}`;
          it(`stores ${label}`, () => {
            const { workspace, home, endpoint } = fixture();
            const source = endpoint(sourceKind, 0);
            const target = endpoint(targetKind, 1);
            const edge = workspace.addEdge({
              boardId: home.id,
              source: source.id,
              sourceKind,
              target: target.id,
              targetKind,
              sourceConnector: sourceIndex === null ? undefined : source.connectors[sourceIndex],
              targetConnector: targetIndex === null ? undefined : target.connectors[targetIndex],
            });
            if (!edge) throw new Error("expected the link to be created");
            expectStored(
              workspace,
              edge.id,
              {
                kind: sourceKind,
                id: source.id,
                connector: sourceIndex === null ? undefined : source.connectors[sourceIndex],
              },
              {
                kind: targetKind,
                id: target.id,
                connector: targetIndex === null ? undefined : target.connectors[targetIndex],
              },
            );
            // Both ends are reachable from either side, whatever the kinds are.
            expect(workspace.listLinksTo(sourceKind, source.id)).toHaveLength(1);
            expect(workspace.listLinksTo(targetKind, target.id)).toHaveLength(1);
          });
        }
      }
    }
  }

  it("refuses a bare self-link on every kind", () => {
    const { workspace, home, endpoint } = fixture();
    for (const kind of kinds) {
      const self = endpoint(kind, 0);
      expect(
        workspace.addEdge({
          boardId: home.id,
          source: self.id,
          sourceKind: kind,
          target: self.id,
          targetKind: kind,
        }),
      ).toBeNull();
    }
  });

  it("refuses the same dot twice on every kind", () => {
    const { workspace, home, endpoint } = fixture();
    for (const kind of kinds) {
      const self = endpoint(kind, 0);
      const [dot] = self.connectors;
      expect(
        workspace.addEdge({
          boardId: home.id,
          source: self.id,
          sourceKind: kind,
          target: self.id,
          targetKind: kind,
          sourceConnector: dot,
          targetConnector: dot,
        }),
      ).toBeNull();
    }
  });

  it("allows a loop between two of the same entity's dots on every kind", () => {
    const { workspace, home, endpoint } = fixture();
    for (const kind of kinds) {
      const self = endpoint(kind, 0);
      const [first, second] = self.connectors;
      const edge = workspace.addEdge({
        boardId: home.id,
        source: self.id,
        sourceKind: kind,
        target: self.id,
        targetKind: kind,
        sourceConnector: first,
        targetConnector: second,
      });
      if (!edge) throw new Error(`expected a ${kind} loop`);
      expectStored(
        workspace,
        edge.id,
        { kind, id: self.id, connector: first },
        { kind, id: self.id, connector: second },
      );
    }
  });

  it("refuses an endpoint that does not exist, on every kind", () => {
    const { workspace, home, endpoint } = fixture();
    const card = endpoint("card", 0);
    for (const kind of kinds) {
      expect(
        workspace.addEdge({
          boardId: home.id,
          source: "missing",
          sourceKind: kind,
          target: card.id,
        }),
      ).toBeNull();
      expect(
        workspace.addEdge({
          boardId: home.id,
          source: card.id,
          target: "missing",
          targetKind: kind,
        }),
      ).toBeNull();
    }
  });

  it("treats the reversed duplicate as the same connection, on every kind pair", () => {
    for (const sourceKind of kinds) {
      for (const targetKind of kinds) {
        const { workspace, home, endpoint } = fixture();
        const source = endpoint(sourceKind, 0);
        const target = endpoint(targetKind, 1);
        const first = workspace.addEdge({
          boardId: home.id,
          source: source.id,
          sourceKind,
          target: target.id,
          targetKind,
          sourceConnector: source.connectors[0],
          targetConnector: target.connectors[1],
        });
        if (!first) throw new Error("expected the first link");
        expect(
          workspace.addEdge({
            boardId: home.id,
            source: target.id,
            sourceKind: targetKind,
            target: source.id,
            targetKind: sourceKind,
            sourceConnector: target.connectors[1],
            targetConnector: source.connectors[0],
          }),
        ).toBeNull();
        // A different dot is a different connection, not a duplicate.
        const other = workspace.addEdge({
          boardId: home.id,
          source: source.id,
          sourceKind,
          target: target.id,
          targetKind,
          sourceConnector: source.connectors[0],
          targetConnector: target.connectors[2] ?? target.connectors[0],
        });
        expect(other).not.toBeNull();
      }
    }
  });
});

describe("several links between the same two things", () => {
  it("keeps one connection per pair of dots", () => {
    const { workspace, home, endpoint } = fixture();
    const card = endpoint("card", 0);
    const section = endpoint("section", 1);
    const created: string[] = [];
    for (const [fromDot, toDot] of [
      [card.connectors[0], section.connectors[0]],
      [card.connectors[1], section.connectors[1]],
      [card.connectors[1], section.connectors[2]],
    ] as Array<[string | undefined, string | undefined]>) {
      const edge = workspace.addEdge({
        boardId: home.id,
        source: card.id,
        sourceConnector: fromDot,
        target: section.id,
        targetKind: "section",
        targetConnector: toDot,
      });
      if (!edge) throw new Error("expected every distinct dot pair to be kept");
      created.push(edge.id);
    }
    expect(created).toHaveLength(3);
    // One entity, one inspector row: the model keeps them, the reading groups them.
    expect(workspace.listLinksTo("card", card.id)).toHaveLength(3);
    expect(workspace.listLinksTo("section", section.id)).toHaveLength(3);
  });

  it("refuses the same pair of dots twice, whichever way round it is drawn", () => {
    const { workspace, home, endpoint } = fixture();
    const card = endpoint("card", 0);
    const section = endpoint("section", 1);
    const first = workspace.addEdge({
      boardId: home.id,
      source: card.id,
      sourceConnector: card.connectors[0],
      target: section.id,
      targetKind: "section",
      targetConnector: section.connectors[3],
    });
    if (!first) throw new Error("expected the first link");
    expect(
      workspace.addEdge({
        boardId: home.id,
        source: section.id,
        sourceKind: "section",
        sourceConnector: section.connectors[3],
        target: card.id,
        targetConnector: card.connectors[0],
      }),
    ).toBeNull();
  });

  it("lets one dot fan out to several dots of the same other entity", () => {
    const { workspace, home, endpoint } = fixture();
    const card = endpoint("card", 0);
    const section = endpoint("section", 1);
    for (const dot of section.connectors.slice(0, 3)) {
      expect(
        workspace.addEdge({
          boardId: home.id,
          source: card.id,
          sourceConnector: card.connectors[2],
          target: section.id,
          targetKind: "section",
          targetConnector: dot,
        }),
      ).not.toBeNull();
    }
    expect(workspace.listLinksTo("card", card.id)).toHaveLength(3);
  });
});

describe("reconnect matrix", () => {
  for (const end of ["source", "target"] as const) {
    for (const kind of kinds) {
      for (const connectorIndex of [null, 0, 1] as const) {
        it(`retargets ${end} to ${kind}:${connectorIndex ?? "-"}`, () => {
          const { workspace, home, endpoint } = fixture();
          const card = endpoint("card", 0);
          const section = endpoint("section", 1);
          const edge = workspace.addEdge({
            boardId: home.id,
            source: card.id,
            target: section.id,
            targetKind: "section",
            sourceConnector: card.connectors[0],
            targetConnector: section.connectors[0],
          });
          if (!edge) throw new Error("expected the link to be created");

          const moving = endpoint(kind, 0);
          const connectorId =
            connectorIndex === null ? undefined : moving.connectors[connectorIndex];
          workspace.reconnectEdge(edge.id, end, moving.id, connectorId, kind);

          // The end that was not retargeted keeps its entity, kind and dot.
          const anchoredCard = {
            kind: "card" as const,
            id: card.id,
            connector: card.connectors[0],
          };
          const anchoredSection = {
            kind: "section" as const,
            id: section.id,
            connector: section.connectors[0],
          };
          const next = { kind, id: moving.id, connector: connectorId };
          const collapses =
            end === "target" &&
            moving.id === card.id &&
            (connectorId === undefined || connectorId === card.connectors[0]);
          // Dragging the target back onto the source's own dot is the same
          // zero-length link a fresh drag refuses, so the edge stays put.
          expectStored(
            workspace,
            edge.id,
            collapses ? anchoredCard : end === "source" ? next : anchoredCard,
            collapses ? anchoredSection : end === "source" ? anchoredSection : next,
          );
        });
      }
    }
  }

  it("refuses a reconnect that would collapse the link onto one dot", () => {
    const { workspace, home, endpoint } = fixture();
    const card = endpoint("card", 0);
    const section = endpoint("section", 1);
    const edge = workspace.addEdge({
      boardId: home.id,
      source: card.id,
      target: section.id,
      targetKind: "section",
      sourceConnector: card.connectors[0],
      targetConnector: section.connectors[0],
    });
    if (!edge) throw new Error("expected the link to be created");
    // Same section, same dot it already uses: that is a zero-length link.
    workspace.reconnectEdge(edge.id, "source", section.id, section.connectors[0], "section");
    const stored = workspace.listEdges().find((entry) => entry.id === edge.id);
    expect(edgeEndpoints(stored ?? edge).source).toEqual({ kind: "card", id: card.id });
  });
});

describe("reverse", () => {
  it("keeps every endpoint with its own kind and connector", () => {
    const { workspace, home, endpoint } = fixture();
    const card = endpoint("card", 0);
    const section = endpoint("section", 1);
    const edge = workspace.addEdge({
      boardId: home.id,
      source: card.id,
      sourceConnector: card.connectors[1],
      target: section.id,
      targetKind: "section",
      targetConnector: section.connectors[2],
    });
    if (!edge) throw new Error("expected the link to be created");
    workspace.reverseEdge(edge.id);
    expectStored(
      workspace,
      edge.id,
      { kind: "section", id: section.id, connector: section.connectors[2] },
      { kind: "card", id: card.id, connector: card.connectors[1] },
    );
  });

  it("keeps a board endpoint pointing at the board", () => {
    const { workspace, home, endpoint, portalA } = fixture();
    const opened = endpoint("board", 0);
    const edge = workspace.addEdge({
      boardId: home.id,
      source: home.id,
      sourceKind: "board",
      target: opened.id,
      targetKind: "board",
      sourceConnector: portalA.connectors[0]?.id,
      targetConnector: portalA.connectors[1]?.id,
    });
    if (!edge) throw new Error("expected the link to be created");
    workspace.reverseEdge(edge.id);
    expectStored(
      workspace,
      edge.id,
      { kind: "board", id: opened.id, connector: portalA.connectors[1]?.id },
      { kind: "board", id: home.id, connector: portalA.connectors[0]?.id },
    );
  });
});
