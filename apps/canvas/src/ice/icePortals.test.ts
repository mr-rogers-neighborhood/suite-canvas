import {
  type Board,
  type Card,
  type GraphEdge,
  type Placement,
  PORTAL_BOARD_FIELD_ID,
  PORTAL_TYPE_ID,
  type Section,
} from "@suite/graph";
import { rectContainsRect } from "@suite/scene";
import { describe, expect, it } from "vitest";
import {
  compareIcePaint,
  DEFAULT_ICE_PORTAL_CONFIG,
  ICE_CARD_SIZE,
  type IcePortalSource,
  iceEdgeKey,
  iceInstanceKey,
  iceSectionKey,
  iceStubKey,
  planIcePortals,
} from "./icePortals";

const NOTE_TYPE_ID = "note";

/** `noUncheckedIndexedAccess` is on: a missing fixture row is a test bug. */
function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`Expected an item at index ${index}.`);
  return value;
}

function last<T>(items: readonly T[]): T {
  return at(items, items.length - 1);
}

function board(id: string, name: string): Board {
  return { id, name, createdAt: 0, updatedAt: 0 };
}

function noteCard(id: string, connectors: readonly { id: string; x: number; y: number }[] = []) {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    connectors: [...connectors],
    typeIds: [NOTE_TYPE_ID],
    primaryTypeId: NOTE_TYPE_ID,
    tags: [],
    properties: {},
  } satisfies Card;
}

function portalCard(id: string, target: string): Card {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    connectors: [],
    typeIds: [PORTAL_TYPE_ID],
    primaryTypeId: PORTAL_TYPE_ID,
    tags: [],
    properties: { [PORTAL_BOARD_FIELD_ID]: target },
  };
}

function place(
  boardId: string,
  cardId: string,
  x: number,
  y: number,
  z: number,
  size?: { width: number; height: number },
): Placement {
  return {
    boardId,
    cardId,
    x,
    y,
    z,
    createdAt: 0,
    ...(size === undefined ? {} : { width: size.width, height: size.height }),
  };
}

function section(
  id: string,
  boardId: string,
  z: number,
  title: string,
  color?: Section["color"],
): Section {
  return {
    id,
    boardId,
    title,
    x: 0,
    y: 0,
    width: 700,
    height: 520,
    z,
    createdAt: 0,
    updatedAt: 0,
    ...(color === undefined ? {} : { color }),
  };
}

function edge(
  id: string,
  boardId: string,
  source: string,
  target: string,
  connectors: { readonly sourceConnector: string; readonly targetConnector: string } | undefined,
  label?: string,
): GraphEdge {
  return {
    id,
    boardId,
    source,
    target,
    kind: "relates-to",
    path: "bezier",
    bidirectional: false,
    createdAt: 0,
    updatedAt: 0,
    ...(connectors ?? {}),
    ...(label === undefined ? {} : { label }),
  };
}

/**
 * Root -> two portals to Alpha -> Alpha's own portal to Beta, plus a portal
 * back to the root (a cycle) and one to a board the snapshot does not contain.
 */
function exampleSource(): IcePortalSource {
  return {
    boards: [
      board("board-root", "Root"),
      board("board-alpha", "Alpha"),
      board("board-beta", "Beta"),
    ],
    cards: [
      noteCard("note-root-1", [{ id: "east", x: 1, y: 0.5 }]),
      noteCard("note-root-2", [{ id: "west", x: 0, y: 0.5 }]),
      portalCard("portal-alpha-1", "board-alpha"),
      portalCard("portal-alpha-2", "board-alpha"),
      portalCard("portal-missing", "board-ghost"),
      noteCard("note-alpha-1", [{ id: "east", x: 1, y: 0.5 }]),
      noteCard("note-alpha-2", [{ id: "west", x: 0, y: 0.5 }]),
      portalCard("portal-beta", "board-beta"),
      portalCard("portal-loop", "board-root"),
      noteCard("note-beta"),
    ],
    placements: [
      place("board-root", "note-root-1", 0, 0, 0),
      place("board-root", "note-root-2", 400, 0, 1),
      place("board-root", "portal-alpha-1", 0, 300, 2, { width: 300, height: 260 }),
      place("board-root", "portal-alpha-2", 360, 300, 3, { width: 300, height: 260 }),
      place("board-root", "portal-missing", 720, 300, 4),
      place("board-alpha", "note-alpha-1", 0, 0, 0),
      place("board-alpha", "note-alpha-2", 400, 0, 1),
      place("board-alpha", "portal-beta", 0, 300, 2, { width: 300, height: 260 }),
      place("board-alpha", "portal-loop", 360, 300, 3),
      place("board-beta", "note-beta", 0, 0, 0),
    ],
    sections: [
      section("section-root", "board-root", 2, "Root region", "blue"),
      section("section-alpha", "board-alpha", 1, "Alpha region", "green"),
    ],
    edges: [
      edge("edge-root", "board-root", "note-root-1", "note-root-2", {
        sourceConnector: "east",
        targetConnector: "west",
      }),
      edge(
        "edge-alpha",
        "board-alpha",
        "note-alpha-1",
        "note-alpha-2",
        { sourceConnector: "east", targetConnector: "west" },
        "Alpha link",
      ),
    ],
  };
}

/** A chain `b0 -> b1 -> ... -> b{n}` with a note on the last board. */
function chainSource(links: number): IcePortalSource {
  const boards: Board[] = [];
  const cards: Card[] = [];
  const placements: Placement[] = [];

  for (let index = 0; index < links; index += 1) {
    boards.push(board(`b${index}`, `B${index}`));
    cards.push(portalCard(`portal-${index}`, `b${index + 1}`));
    placements.push(place(`b${index}`, `portal-${index}`, 0, 0, 0, { width: 300, height: 260 }));
  }
  boards.push(board(`b${links}`, `B${links}`));
  cards.push(noteCard("leaf"));
  placements.push(place(`b${links}`, "leaf", 0, 0, 0));

  return { boards, cards, placements };
}

describe("icePortals", () => {
  it("should plan the root board as one identity instance", () => {
    const plan = planIcePortals(
      {
        boards: [board("solo", "Solo")],
        cards: [noteCard("note")],
        placements: [place("solo", "note", 12, 34, 0)],
      },
      "solo",
    );

    expect(plan.rootBoardId).toBe("solo");
    expect(plan.maxDepth).toBe(DEFAULT_ICE_PORTAL_CONFIG.maxDepth);
    expect(plan.instances).toHaveLength(1);

    const root = at(plan.instances, 0);
    expect(root).toMatchObject({
      key: "b:solo",
      boardId: "solo",
      boardName: "Solo",
      depth: 0,
      parentKey: null,
      parentPath: [],
      portalCardId: null,
      placementId: null,
    });
    expect(root.transform).toEqual({ scale: 1, x: 0, y: 0 });
    expect(root.bounds).toEqual({ x: 12, y: 34, ...ICE_CARD_SIZE });
    expect(root.rect).toEqual(root.bounds);
    expect(root.frame).toEqual(root.bounds);
    expect(root.path).toEqual(["solo"]);

    expect(plan.boards).toEqual([
      { boardId: "solo", name: "Solo", instanceKeys: ["b:solo"], instanceCount: 1 },
    ]);
    expect(plan.sections).toEqual([]);
    expect(plan.edges).toEqual([]);
    expect(plan.stubs).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.counts).toEqual({
      boards: 1,
      instances: 1,
      sections: 0,
      edges: 0,
      stubs: 0,
      cycles: 0,
      depthStops: 0,
      missing: 0,
      maxDepth: 0,
    });
  });

  it("should nest two levels and fit every instance inside its portal frame", () => {
    const plan = planIcePortals(exampleSource(), "board-root");

    expect(plan.instances.map((instance) => instance.depth)).toEqual([0, 1, 2, 1, 2]);
    expect(plan.instances.map((instance) => instance.path.join("/"))).toEqual([
      "board-root",
      "board-root/board-alpha",
      "board-root/board-alpha/board-beta",
      "board-root/board-alpha",
      "board-root/board-alpha/board-beta",
    ]);

    const root = at(plan.instances, 0);
    expect(root.frame).toEqual(root.rect);

    const alphas = plan.instances.filter((instance) => instance.boardId === "board-alpha");
    expect(alphas).toHaveLength(2);
    for (const alpha of alphas) {
      expect(alpha.parentKey).toBe(root.key);
      expect(alpha.parentPath).toEqual(["board-root"]);
      expect(rectContainsRect(alpha.frame, alpha.rect, 1e-6)).toBe(true);
      expect(alpha.transform.scale).toBeGreaterThan(0);
      expect(alpha.transform.scale).toBeLessThan(1);
    }

    const betas = plan.instances.filter((instance) => instance.boardId === "board-beta");
    expect(betas).toHaveLength(2);
    for (const beta of betas) {
      const parent = plan.instances.find((instance) => instance.key === beta.parentKey);
      expect(parent?.boardId).toBe("board-alpha");
      expect(beta.parentPath).toEqual(parent?.path);
      expect(beta.portalCardId).toBe("portal-beta");
      expect(beta.placementId).toBe("board-alpha/portal-beta");
      if (parent) {
        expect(rectContainsRect(parent.frame, beta.frame, 1e-6)).toBe(true);
      }
      expect(rectContainsRect(beta.frame, beta.rect, 1e-6)).toBe(true);
      // A deeper instance's content is smaller in page space than its parent's.
      expect(beta.frame.width).toBeLessThan(at(alphas, 0).frame.width);
      expect(beta.rect.width).toBeLessThan(at(alphas, 0).rect.width);
    }

    expect(plan.boards.map((entry) => [entry.boardId, entry.instanceCount])).toEqual([
      ["board-root", 1],
      ["board-alpha", 2],
      ["board-beta", 2],
    ]);
    expect(plan.counts).toEqual({
      boards: 3,
      instances: 5,
      sections: 3,
      edges: 3,
      stubs: 3,
      cycles: 2,
      depthStops: 0,
      missing: 1,
      maxDepth: 2,
    });
  });

  it("should keep two portals to one board as two instances with distinct keys", () => {
    const plan = planIcePortals(exampleSource(), "board-root");
    const alphas = plan.instances.filter((instance) => instance.boardId === "board-alpha");

    expect(alphas.map((instance) => instance.key)).toEqual([
      iceInstanceKey("b:board-root", "board-alpha", "portal-alpha-1"),
      iceInstanceKey("b:board-root", "board-alpha", "portal-alpha-2"),
    ]);
    expect(new Set(alphas.map((instance) => instance.key)).size).toBe(2);
    expect(alphas.map((instance) => instance.portalCardId)).toEqual([
      "portal-alpha-1",
      "portal-alpha-2",
    ]);
    expect(alphas.map((instance) => instance.placementId)).toEqual([
      "board-root/portal-alpha-1",
      "board-root/portal-alpha-2",
    ]);
    // Two placements of the same canonical board, not a clone of it.
    expect(new Set(alphas.map((instance) => instance.boardId))).toEqual(new Set(["board-alpha"]));
    expect(at(alphas, 0).path).toEqual(at(alphas, 1).path);

    const rollup = plan.boards.find((entry) => entry.boardId === "board-alpha");
    expect(rollup?.instanceKeys).toEqual(alphas.map((instance) => instance.key));
    expect(rollup?.instanceCount).toBe(2);
  });

  it("should stop a cycle with a visible stub per instance", () => {
    const plan = planIcePortals(exampleSource(), "board-root");

    expect(plan.stubs.map((stub) => stub.reason)).toEqual(["cycle", "cycle", "missing"]);
    expect(plan.instances.filter((instance) => instance.boardId === "board-root")).toHaveLength(1);

    const cycleStubs = plan.stubs.filter((stub) => stub.reason === "cycle");
    expect(cycleStubs).toHaveLength(2);
    for (const stub of cycleStubs) {
      const instance = plan.instances.find((entry) => entry.key === stub.instanceKey);
      expect(stub.boardId).toBe("board-alpha");
      expect(stub.portalCardId).toBe("portal-loop");
      expect(stub.placementId).toBe("board-alpha/portal-loop");
      expect(stub.targetBoardId).toBe("board-root");
      expect(stub.targetBoardName).toBe("Root");
      expect(stub.label).toBe("Root");
      expect(stub.key).toBe(iceStubKey(instance?.key ?? "", "portal-loop"));
      expect(stub.local).toEqual({ x: 360, y: 300, ...ICE_CARD_SIZE });
      expect(stub.clip).toEqual(instance?.frame);
      if (instance) expect(rectContainsRect(instance.frame, stub.frame, 1e-6)).toBe(true);
      // The stub never opens a child instance.
      expect(plan.instances.some((entry) => entry.parentKey === stub.key)).toBe(false);
    }

    expect(plan.skipped.map((entry) => entry.reason)).toEqual(["cycle", "cycle", "missing"]);
    expect(at(plan.skipped, 0).detail).toContain("already on the path");
    expect(plan.counts.cycles).toBe(2);
  });

  it("should hold the depth cap with a stub at the first over-budget portal", () => {
    const plan = planIcePortals(chainSource(9), "b0");

    expect(plan.maxDepth).toBe(6);
    expect(plan.instances.map((instance) => instance.boardId)).toEqual([
      "b0",
      "b1",
      "b2",
      "b3",
      "b4",
      "b5",
      "b6",
    ]);
    expect(plan.counts.maxDepth).toBe(6);
    expect(plan.stubs).toHaveLength(1);
    expect(at(plan.stubs, 0)).toMatchObject({
      reason: "depth",
      depth: 7,
      boardId: "b6",
      portalCardId: "portal-6",
      targetBoardId: "b7",
    });
    expect(at(plan.stubs, 0).label).toBe("B7");
    expect(plan.counts.depthStops).toBe(1);
    expect(plan.counts.missing).toBe(0);
  });

  it("should accept a shallower cap without changing the walk", () => {
    const plan = planIcePortals(chainSource(9), "b0", { maxDepth: 2 });

    expect(plan.maxDepth).toBe(2);
    expect(plan.instances.map((instance) => instance.boardId)).toEqual(["b0", "b1", "b2"]);
    expect(plan.stubs).toHaveLength(1);
    expect(at(plan.stubs, 0)).toMatchObject({ reason: "depth", depth: 3, targetBoardId: "b3" });
    expect(at(plan.skipped, 0).detail).toContain("stops at 2");
  });

  it("should mark a missing target as an unavailable stub", () => {
    const plan = planIcePortals(exampleSource(), "board-root");
    const stub = plan.stubs.find((entry) => entry.reason === "missing");

    expect(stub).toBeDefined();
    expect(stub?.boardId).toBe("board-root");
    expect(stub?.portalCardId).toBe("portal-missing");
    expect(stub?.targetBoardId).toBe("board-ghost");
    expect(stub?.targetBoardName).toBeNull();
    expect(stub?.label).toBe("Unavailable board");
    expect(stub?.frame).toEqual({ x: 720, y: 300, ...ICE_CARD_SIZE });
    expect(stub?.clip).toEqual(at(plan.instances, 0).frame);
    expect(last(plan.skipped)?.detail).toContain("not in the snapshot");
  });

  it("should treat a portal with an empty target as unavailable", () => {
    const plan = planIcePortals(
      {
        boards: [board("b0", "B0")],
        cards: [portalCard("portal-empty", "")],
        placements: [place("b0", "portal-empty", 10, 20, 0)],
      },
      "b0",
    );

    expect(plan.stubs).toHaveLength(1);
    expect(at(plan.stubs, 0)).toMatchObject({
      reason: "missing",
      targetBoardId: "",
      targetBoardName: null,
      label: "Unavailable board",
      key: iceStubKey("b:b0", "portal-empty"),
    });
    expect(at(plan.skipped, 0).detail).toBe("Portal has no target board.");
  });

  it("should share canonical section and edge ids across instances and clip to each frame", () => {
    const plan = planIcePortals(exampleSource(), "board-root");
    const alphas = plan.instances.filter((instance) => instance.boardId === "board-alpha");

    const alphaSections = plan.sections.filter((entry) => entry.sectionId === "section-alpha");
    expect(alphaSections).toHaveLength(2);
    expect(alphaSections.map((entry) => entry.key)).toEqual([
      iceSectionKey(at(alphas, 0).key, "section-alpha"),
      iceSectionKey(at(alphas, 1).key, "section-alpha"),
    ]);
    expect(alphaSections.map((entry) => entry.instanceKey)).toEqual(
      alphas.map((entry) => entry.key),
    );
    expect(at(alphaSections, 0).local).toEqual(at(alphaSections, 1).local);
    expect(at(alphaSections, 0).rect).not.toEqual(at(alphaSections, 1).rect);
    expect(at(alphaSections, 0).clip).toEqual(at(alphas, 0).frame);
    expect(at(alphaSections, 1).clip).toEqual(at(alphas, 1).frame);
    expect(at(alphaSections, 0)).toMatchObject({
      boardId: "board-alpha",
      layer: "section",
      z: 1,
      title: "Alpha region",
      color: "green",
      depth: 1,
    });
    expect(at(alphaSections, 0).path).toEqual(["board-root", "board-alpha"]);

    const alphaEdges = plan.edges.filter((entry) => entry.edgeId === "edge-alpha");
    expect(alphaEdges).toHaveLength(2);
    expect(alphaEdges.map((entry) => entry.key)).toEqual([
      iceEdgeKey(at(alphas, 0).key, "edge-alpha"),
      iceEdgeKey(at(alphas, 1).key, "edge-alpha"),
    ]);
    expect(at(alphaEdges, 0).localFrom).toEqual(at(alphaEdges, 1).localFrom);
    expect(at(alphaEdges, 0).localTo).toEqual(at(alphaEdges, 1).localTo);
    expect(at(alphaEdges, 0).from).not.toEqual(at(alphaEdges, 1).from);
    expect(at(alphaEdges, 0).clip).toEqual(at(alphas, 0).frame);
    expect(at(alphaEdges, 0)).toMatchObject({
      boardId: "board-alpha",
      layer: "edge",
      kind: "relates-to",
      route: "bezier",
      bidirectional: false,
      label: "Alpha link",
      labelOffset: null,
    });
    // The anchor is the connector, not the card centre.
    const placement = { x: 0, y: 0, width: ICE_CARD_SIZE.width, height: ICE_CARD_SIZE.height };
    expect(at(alphaEdges, 0).localFrom).toEqual({
      x: placement.x + placement.width,
      y: placement.y + placement.height / 2,
    });

    // The root's own descriptors stay single-instance.
    expect(plan.sections.filter((entry) => entry.sectionId === "section-root")).toHaveLength(1);
    expect(plan.edges.filter((entry) => entry.edgeId === "edge-root")).toHaveLength(1);
  });

  it("should order sections by z then id, edges by id, and paint sections first", () => {
    const plan = planIcePortals(
      {
        boards: [board("b0", "B0")],
        cards: [noteCard("n1"), noteCard("n2")],
        placements: [place("b0", "n2", 400, 0, 0), place("b0", "n1", 0, 0, 1)],
        sections: [
          section("section-b", "b0", 3, "B"),
          section("section-a", "b0", 1, "A"),
          section("section-c", "b0", 3, "C"),
        ],
        edges: [
          edge("edge-z", "b0", "n1", "n2", undefined),
          edge("edge-a", "b0", "n1", "n2", undefined),
        ],
      },
      "b0",
    );

    expect(plan.sections.map((entry) => entry.sectionId)).toEqual([
      "section-a",
      "section-b",
      "section-c",
    ]);
    expect(plan.sections.map((entry) => entry.z)).toEqual([1, 3, 3]);
    expect(plan.edges.map((entry) => entry.edgeId)).toEqual(["edge-a", "edge-z"]);
    expect(plan.edges.map((entry) => entry.z)).toEqual([0, 1]);

    const painted = [...plan.sections, ...plan.edges].sort(compareIcePaint);
    expect(painted.map((entry) => entry.layer)).toEqual([
      "section",
      "section",
      "section",
      "edge",
      "edge",
    ]);
  });

  it("should be deterministic for reordered input and never mutate it", () => {
    const source = exampleSource();
    const placementsBefore = source.placements.map((entry) => `${entry.boardId}/${entry.cardId}`);
    const sectionsBefore = (source.sections ?? []).map((entry) => entry.id);
    const edgesBefore = (source.edges ?? []).map((entry) => entry.id);

    const shuffled: IcePortalSource = {
      boards: [...source.boards].reverse(),
      cards: [...source.cards].reverse(),
      placements: [...source.placements].reverse(),
      sections: [...(source.sections ?? [])].reverse(),
      edges: [...(source.edges ?? [])].reverse(),
    };

    expect(planIcePortals(shuffled, "board-root")).toEqual(planIcePortals(source, "board-root"));

    expect(source.placements.map((entry) => `${entry.boardId}/${entry.cardId}`)).toEqual(
      placementsBefore,
    );
    expect((source.sections ?? []).map((entry) => entry.id)).toEqual(sectionsBefore);
    expect((source.edges ?? []).map((entry) => entry.id)).toEqual(edgesBefore);
  });
});
