import { describe, expect, it } from "vitest";
import {
  buildScene,
  cardInstanceKey,
  DEFAULT_PORTAL_CONFIG,
  portalInstanceKey,
  SCENE_PORTAL_BOARD_FIELD_ID,
  SCENE_PORTAL_TYPE_ID,
} from "./scene.js";
import type {
  BuildSceneInput,
  Camera,
  LodConfig,
  PortalConfig,
  SceneCardInput,
  SceneConfig,
  SceneEdgeInput,
  ScenePlacementInput,
} from "./types.js";

const note = (id: string): SceneCardInput => ({ id, primaryTypeId: "note", properties: {} });

const portalCard = (id: string, targetBoardId: string): SceneCardInput => ({
  id,
  primaryTypeId: SCENE_PORTAL_TYPE_ID,
  properties: { [SCENE_PORTAL_BOARD_FIELD_ID]: targetBoardId },
});

function place(
  boardId: string,
  cardId: string,
  x: number,
  y: number,
  size: { width?: number; height?: number; z?: number } = {},
): ScenePlacementInput {
  return {
    boardId,
    cardId,
    x,
    y,
    z: size.z ?? 0,
    width: size.width,
    height: size.height,
  };
}

function eagerConfig(overrides: Partial<PortalConfig> = {}, lod?: LodConfig): Partial<SceneConfig> {
  const portal: PortalConfig = {
    ...DEFAULT_PORTAL_CONFIG,
    expansionScale: 0.1,
    collapseScale: 0.05,
    minScreenSize: 0,
    dwellMs: 0,
    padding: 1,
    ...overrides,
  };
  return lod ? { portal, lod } : { portal };
}

const camera = (zoom = 1): Camera => ({ x: 0, y: 0, zoom });

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

const twoBoards: BuildSceneInput = {
  boards: [
    { id: "a", name: "Board A" },
    { id: "b", name: "Board B" },
  ],
  cards: [portalCard("p", "b"), note("n")],
  placements: [
    place("a", "p", 0, 0, { width: 300, height: 200 }),
    place("b", "n", 0, 0, { width: 600, height: 400 }),
  ],
  rootBoardId: "a",
  camera: camera(),
  titles: { p: "To B" },
};

describe("buildScene", () => {
  it("should fit the target board into the portal frame", () => {
    const scene = buildScene({ ...twoBoards, config: eagerConfig() });
    const portal = must(scene.portals[0]);
    expect(portal.expanded).toBe(true);
    expect(portal.impostor).toBe(false);
    expect(portal.targetMissing).toBe(false);
    expect(portal.targetBoardName).toBe("Board B");
    expect(portal.fit.scale).toBeCloseTo(0.5);
    const child = must(scene.boards[1]);
    expect(child.boardId).toBe("b");
    expect(child.depth).toBe(1);
    expect(child.transform).toEqual(portal.fit);
    expect(child.frame).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(scene.counts.expandedPortals).toBe(1);
    expect(scene.counts.impostors).toBe(0);
  });

  it("should keep a portal collapsed when the gate is closed", () => {
    const scene = buildScene({ ...twoBoards, config: eagerConfig({ expansionScale: 2 }) });
    const portal = must(scene.portals[0]);
    expect(portal.expanded).toBe(false);
    expect(portal.impostor).toBe(true);
    expect(portal.reason).toBe("scale");
    expect(portal.childKey).toBeNull();
    expect(scene.boards).toHaveLength(1);
    expect(scene.cards).toHaveLength(1);
    expect(scene.counts.impostors).toBe(1);
  });

  it("should wait for the dwell before expanding", () => {
    const config = eagerConfig({
      expansionScale: 0.5,
      collapseScale: 0.35,
      minScreenSize: 96,
      dwellMs: 80,
      padding: 0.92,
    });
    const first = buildScene({ ...twoBoards, config, nowMs: 0 });
    const portal = must(first.portals[0]);
    expect(portal.expanded).toBe(false);
    expect(portal.reason).toBe("dwell");
    expect(portal.gate.pendingSinceMs).toBe(0);

    const second = buildScene({
      ...twoBoards,
      config,
      nowMs: 40,
      gateStates: { [portal.key]: portal.gate },
    });
    expect(must(second.portals[0]).expanded).toBe(false);

    const third = buildScene({
      ...twoBoards,
      config,
      nowMs: 80,
      gateStates: { [must(second.portals[0]).key]: must(second.portals[0]).gate },
    });
    expect(must(third.portals[0]).expanded).toBe(true);
    expect(must(third.portals[0]).reason).toBe("expanded");
  });

  it("should keep a portal expanded between the two hysteresis bands", () => {
    const config = eagerConfig({
      expansionScale: 0.5,
      collapseScale: 0.35,
      minScreenSize: 0,
      dwellMs: 80,
    });
    const scene = buildScene({
      ...twoBoards,
      camera: camera(0.4),
      config,
      gateStates: { [portalInstanceKey(["a"], "p")]: { expanded: true, pendingSinceMs: null } },
    });
    const portal = must(scene.portals[0]);
    expect(portal.expanded).toBe(true);
    expect(portal.reason).toBe("expanded");
  });

  it("should force-expand a portal on the focus path", () => {
    const scene = buildScene({
      ...twoBoards,
      config: eagerConfig({ expansionScale: 2 }),
      focusPath: ["a", "b"],
    });
    const portal = must(scene.portals[0]);
    expect(portal.expanded).toBe(true);
    expect(portal.reason).toBe("focus");
  });

  it("should stop at a cycle instead of recursing", () => {
    const scene = buildScene({
      boards: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      cards: [portalCard("p1", "b"), note("n1"), portalCard("p2", "a"), note("n2")],
      placements: [
        place("a", "p1", 0, 0, { width: 300, height: 200 }),
        place("a", "n1", 400, 0),
        place("b", "p2", 0, 0, { width: 300, height: 200 }),
        place("b", "n2", 400, 0),
      ],
      rootBoardId: "a",
      camera: camera(),
      config: eagerConfig(),
    });
    expect(scene.boards).toHaveLength(2);
    expect(scene.portals).toHaveLength(2);
    const backPortal = must(scene.portals[1]);
    expect(backPortal.targetBoardId).toBe("a");
    expect(backPortal.cycle).toBe(true);
    expect(backPortal.expanded).toBe(false);
    expect(backPortal.reason).toBe("cycle");
    expect(backPortal.childKey).toBeNull();
  });

  it("should enforce the depth cap", () => {
    const scene = buildScene({
      boards: ["a", "b", "c", "d"].map((id) => ({ id, name: id.toUpperCase() })),
      cards: [portalCard("p1", "b"), portalCard("p2", "c"), portalCard("p3", "d"), note("n")],
      placements: [
        place("a", "p1", 0, 0, { width: 300, height: 200 }),
        place("b", "p2", 0, 0, { width: 300, height: 200 }),
        place("c", "p3", 0, 0, { width: 300, height: 200 }),
        place("d", "n", 0, 0),
      ],
      rootBoardId: "a",
      camera: camera(),
      config: eagerConfig({ maxDepth: 2 }),
    });
    expect(scene.boards).toHaveLength(3);
    expect(scene.boards.map((board) => board.depth)).toEqual([0, 1, 2]);
    const capped = must(scene.portals[2]);
    expect(capped.depthCapped).toBe(true);
    expect(capped.expanded).toBe(false);
    expect(capped.reason).toBe("depth");
  });

  it("should mark a portal with no resolvable target", () => {
    const scene = buildScene({
      boards: [{ id: "a", name: "A" }],
      cards: [portalCard("p", "ghost")],
      placements: [place("a", "p", 0, 0)],
      rootBoardId: "a",
      camera: camera(),
      config: eagerConfig(),
    });
    const portal = must(scene.portals[0]);
    expect(portal.targetMissing).toBe(true);
    expect(portal.expanded).toBe(false);
    expect(portal.reason).toBe("no-target");
  });

  it("should resolve LOD from the effective scale", () => {
    const input: BuildSceneInput = {
      boards: [{ id: "a", name: "A" }],
      cards: [note("n")],
      placements: [place("a", "n", 0, 0)],
      rootBoardId: "a",
      camera: camera(0.5),
      config: eagerConfig(),
    };
    expect(must(buildScene(input).cards[0]).lod).toBe("compact");
    expect(must(buildScene({ ...input, camera: camera(0.05) }).cards[0]).lod).toBe("hidden");
    expect(must(buildScene({ ...input, camera: camera(1) }).cards[0]).lod).toBe("full");
  });

  it("should reuse previous LOD states for hysteresis", () => {
    const scene = buildScene({
      boards: [{ id: "a", name: "A" }],
      cards: [note("n")],
      placements: [place("a", "n", 0, 0)],
      rootBoardId: "a",
      camera: camera(1),
      lodStates: {
        [cardInstanceKey(["a"], "n")]: {
          band: "compact",
          pendingBand: "full",
          pendingSinceMs: 0,
        },
      },
      nowMs: 40,
      config: eagerConfig(),
    });
    expect(must(scene.cards[0]).lod).toBe("compact");
  });

  it("should derive edge endpoints from connectors", () => {
    const edge: SceneEdgeInput = {
      id: "e1",
      boardId: "a",
      source: "left",
      target: "right",
      kind: "references",
      path: "bezier",
      sourceConnector: "mid-right",
      targetConnector: "mid-left",
      label: "links",
    };
    const scene = buildScene({
      boards: [{ id: "a", name: "A" }],
      cards: [
        {
          id: "left",
          primaryTypeId: "note",
          properties: {},
          connectors: [{ id: "mid-right", x: 1, y: 0.5 }],
        },
        {
          id: "right",
          primaryTypeId: "note",
          properties: {},
          connectors: [{ id: "mid-left", x: 0, y: 0.5 }],
        },
      ],
      placements: [
        place("a", "left", 0, 0, { width: 100, height: 50 }),
        place("a", "right", 300, 0, { width: 100, height: 50 }),
      ],
      edges: [edge],
      rootBoardId: "a",
      camera: camera(),
      config: eagerConfig(),
    });
    const instance = must(scene.edges[0]);
    expect(instance.from).toEqual({ x: 100, y: 25 });
    expect(instance.to).toEqual({ x: 300, y: 25 });
    expect(instance.bounds.width).toBe(200);
    expect(instance.bounds.height).toBe(1);
    expect(instance.label).toBe("links");
    expect(instance.route).toBe("bezier");
  });

  it("should skip edges whose endpoints are not on the board", () => {
    const scene = buildScene({
      boards: [{ id: "a", name: "A" }],
      cards: [note("n")],
      placements: [place("a", "n", 0, 0)],
      edges: [
        {
          id: "e",
          boardId: "a",
          source: "n",
          target: "ghost",
          kind: "relates-to",
          path: "straight",
        },
      ],
      rootBoardId: "a",
      camera: camera(),
      config: eagerConfig(),
    });
    expect(scene.edges).toHaveLength(0);
  });

  it("should carry card titles from the titles map", () => {
    const scene = buildScene({ ...twoBoards, config: eagerConfig() });
    expect(must(scene.cards[0]).title).toBe("To B");
  });

  it("should never mutate its input", () => {
    const input = deepFreeze(structuredClone(twoBoards));
    const before = JSON.stringify(input);
    buildScene({ ...input, config: eagerConfig() });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("should be deterministic for the same input", () => {
    const input: BuildSceneInput = { ...twoBoards, config: eagerConfig() };
    expect(buildScene(input)).toEqual(buildScene(input));
  });
});
