import { describe, expect, it } from "vitest";
import type { DragSession } from "./interaction.js";
import {
  beginDrag,
  distanceToEdge,
  dragDelta,
  edgeRouteBounds,
  edgeRoutePolyline,
  hitTest,
  hitTestEdge,
  hitTestRect,
  marqueeRect,
  rectSelectionKeys,
  resizeFromHandle,
  resizeMove,
  selectionBounds,
} from "./interaction.js";
import {
  buildScene,
  cardInstanceKey,
  DEFAULT_PORTAL_CONFIG,
  SCENE_PORTAL_BOARD_FIELD_ID,
  SCENE_PORTAL_TYPE_ID,
} from "./scene.js";
import type {
  BuildSceneInput,
  Camera,
  CardInstance,
  EdgeInstance,
  LodConfig,
  PortalConfig,
  Scene,
  SceneCardInput,
  SceneConfig,
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
  return { boardId, cardId, x, y, z: size.z ?? 0, width: size.width, height: size.height };
}

/** Portals expand immediately and their child board exactly fills the frame. */
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

const camera = (zoom = 1, x = 0, y = 0): Camera => ({ x, y, zoom });

/**
 * Board `a` (root):
 *   c1 (0,0) 100x80        c2 (60,40) 100x80 z1   -> overlap
 *   s1 (300,0) 200x150     c3 (320,20) 80x60 z5   -> card over section
 *   e1a (0,300)            e1b (500,300)           -> straight edge y=340
 *   p  (600,0) 300x200 -> board `b` with n1 (0,0) 600x400, fit scale 0.5
 */
const sceneInput: BuildSceneInput = {
  boards: [
    { id: "a", name: "Board A" },
    { id: "b", name: "Board B" },
  ],
  cards: [
    note("c1"),
    note("c2"),
    note("c3"),
    note("e1a"),
    note("e1b"),
    portalCard("p", "b"),
    note("n1"),
  ],
  placements: [
    place("a", "c1", 0, 0, { width: 100, height: 80 }),
    place("a", "c2", 60, 40, { width: 100, height: 80, z: 1 }),
    place("a", "c3", 320, 20, { width: 80, height: 60, z: 5 }),
    place("a", "e1a", 0, 300, { width: 100, height: 80 }),
    place("a", "e1b", 500, 300, { width: 100, height: 80 }),
    place("a", "p", 600, 0, { width: 300, height: 200 }),
    place("b", "n1", 0, 0, { width: 600, height: 400 }),
  ],
  sections: [
    { id: "s1", boardId: "a", title: "Section", x: 300, y: 0, width: 200, height: 150, z: 0 },
  ],
  edges: [
    {
      id: "e1",
      boardId: "a",
      source: "e1a",
      target: "e1b",
      kind: "references",
      path: "straight",
    },
  ],
  rootBoardId: "a",
  camera: camera(),
  titles: { p: "Portal" },
  config: eagerConfig(),
};

const scene: Scene = buildScene(sceneInput);

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

function card(id: string): CardInstance {
  return must(scene.cards.find((candidate) => candidate.cardId === id));
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

function edge(
  from: { x: number; y: number },
  to: { x: number; y: number },
  route: EdgeInstance["route"],
): EdgeInstance {
  return {
    key: "b:e",
    edgeId: "e",
    boardId: "a",
    boardKey: "b:",
    path: ["a"],
    transform: { scale: 1, x: 0, y: 0 },
    from,
    to,
    bounds: edgeRouteBounds(from, to, route),
    kind: "references",
    route,
    label: null,
    lod: "full",
  };
}

describe("hitTest", () => {
  it("should hit a card at zoom 1 with page and board points", () => {
    const hit = hitTest(scene, camera(), { x: 50, y: 40 });
    expect(hit.kind).toBe("card");
    if (hit.kind !== "card") return;
    expect(hit.cardId).toBe("c1");
    expect(hit.instanceKey).toBe(cardInstanceKey(["a"], "c1"));
    expect(hit.boardId).toBe("a");
    expect(hit.path).toEqual(["a"]);
    expect(hit.page).toEqual({ x: 50, y: 40 });
    expect(hit.board).toEqual({ x: 50, y: 40 });
  });

  it("should map a screen point through the camera at zoom 0.4", () => {
    // A scene carries the LOD of its own camera, so rebuild at the tested zoom.
    const zoomed = buildScene({ ...sceneInput, camera: camera(0.4, 40, 20) });
    const hit = hitTest(zoomed, camera(0.4, 40, 20), { x: 30 * 0.4 + 40, y: 30 * 0.4 + 20 });
    expect(hit.kind).toBe("card");
    if (hit.kind !== "card") return;
    expect(hit.cardId).toBe("c1");
    expect(hit.page.x).toBeCloseTo(30);
    expect(hit.page.y).toBeCloseTo(30);
    expect(hit.lod).not.toBe("hidden");
  });

  it("should pick the topmost card when cards overlap", () => {
    const overlap = hitTest(scene, camera(), { x: 70, y: 50 });
    expect(overlap.kind).toBe("card");
    if (overlap.kind !== "card") return;
    expect(overlap.cardId).toBe("c2");
    expect(overlap.z).toBe(1);
  });

  it("should prefer a card over the section it sits in", () => {
    const overCard = hitTest(scene, camera(), { x: 350, y: 40 });
    expect(overCard.kind).toBe("card");
    if (overCard.kind !== "card") return;
    expect(overCard.cardId).toBe("c3");

    const overSection = hitTest(scene, camera(), { x: 450, y: 100 });
    expect(overSection.kind).toBe("section");
    if (overSection.kind !== "section") return;
    expect(overSection.sectionId).toBe("s1");
    expect(overSection.local).toEqual({ x: 300, y: 0, width: 200, height: 150 });
  });

  it("should hit an edge within tolerance and miss it beyond it", () => {
    const onEdge = hitTest(scene, camera(), { x: 300, y: 343 });
    expect(onEdge.kind).toBe("edge");
    if (onEdge.kind !== "edge") return;
    expect(onEdge.edgeId).toBe("e1");
    expect(onEdge.distance).toBeCloseTo(3);

    expect(hitTest(scene, camera(), { x: 300, y: 360 }).kind).toBe("pane");
  });

  it("should hit the edge helper with the closest route", () => {
    const hit = hitTestEdge(scene, camera(), { x: 300, y: 344 });
    expect(hit).not.toBeNull();
    expect(hit?.edgeId).toBe("e1");
    expect(hit?.distance).toBeCloseTo(4);
    expect(hitTestEdge(scene, camera(), { x: 300, y: 400 })).toBeNull();
  });

  it("should fall back to a pane hit on empty board space", () => {
    const hit = hitTest(scene, camera(), { x: 250, y: 200 });
    expect(hit.kind).toBe("pane");
    expect(hit.boardId).toBe("a");
    expect(hit.instanceKey).toBe(scene.root.key);
    expect(hit.page).toEqual({ x: 250, y: 200 });
  });

  it("should let a portal win on its header but not over its live child area", () => {
    const header = hitTest(scene, camera(), { x: 700, y: 10 });
    expect(header.kind).toBe("portal");
    if (header.kind !== "portal") return;
    expect(header.cardId).toBe("p");
    expect(header.part).toBe("header");
    expect(header.expanded).toBe(true);
    expect(header.targetBoardId).toBe("b");

    const child = hitTest(scene, camera(), { x: 700, y: 140 });
    expect(child.kind).toBe("card");
    if (child.kind !== "card") return;
    expect(child.cardId).toBe("n1");
    expect(child.boardId).toBe("b");
    expect(child.path).toEqual(["a", "b"]);
  });

  it("should hit the portal frame ring", () => {
    const ring = hitTest(scene, camera(), { x: 603, y: 140 });
    expect(ring.kind).toBe("portal");
    if (ring.kind !== "portal") return;
    expect(ring.part).toBe("frame");
  });

  it("should treat a collapsed portal frame as a whole target", () => {
    const collapsed = buildScene({
      ...sceneInput,
      config: eagerConfig({ expansionScale: 2 }),
    });
    const hit = hitTest(collapsed, camera(), { x: 700, y: 140 });
    expect(hit.kind).toBe("portal");
    if (hit.kind !== "portal") return;
    expect(hit.expanded).toBe(false);
    expect(hit.part).toBe("body");
  });

  it("should map a point into a nested scaled board", () => {
    const hit = hitTest(scene, camera(), { x: 650, y: 100 });
    expect(hit.kind).toBe("card");
    if (hit.kind !== "card") return;
    expect(hit.cardId).toBe("n1");
    // Child board scale is 0.5 and its page origin is the portal frame origin.
    expect(hit.board.x).toBeCloseTo(100);
    expect(hit.board.y).toBeCloseTo(200);
    expect(hit.local).toEqual({ x: 0, y: 0, width: 600, height: 400 });
  });

  it("should ignore hidden LOD instances", () => {
    const tiny = buildScene({ ...sceneInput, camera: camera(0.05) });
    expect(hitTest(tiny, camera(0.05), { x: 2.5, y: 2 }).kind).toBe("pane");

    const strictConfig = eagerConfig(
      {},
      { thresholds: { full: 0.9, compact: 0.7, icon: 0.5 }, dwellMs: 0 },
    );
    const tinyStrict = buildScene({ ...sceneInput, camera: camera(0.4), config: strictConfig });
    expect(hitTest(tinyStrict, camera(0.4), { x: 20, y: 16 }).kind).toBe("pane");

    const visible = buildScene({ ...sceneInput, camera: camera(0.95), config: strictConfig });
    expect(hitTest(visible, camera(0.95), { x: 47.5, y: 38 }).kind).toBe("card");
  });

  it("should never crash on a non-finite point", () => {
    const hit = hitTest(scene, camera(), { x: Number.NaN, y: 0 });
    expect(hit.page).toEqual({ x: 0, y: 0 });
    expect(Number.isFinite(hit.board.x)).toBe(true);
    expect(Number.isFinite(hit.board.y)).toBe(true);
  });

  it("should not mutate the scene", () => {
    const frozen = deepFreeze(buildScene(sceneInput));
    expect(() => hitTest(frozen, camera(), { x: 70, y: 50 })).not.toThrow();
    expect(() =>
      hitTestRect(frozen, camera(), { x: 0, y: 0, width: 400, height: 400 }),
    ).not.toThrow();
    expect(() =>
      selectionBounds(frozen, [card("c1").key, must(scene.sections[0]).key]),
    ).not.toThrow();
  });
});

describe("hitTestRect", () => {
  it("should select intersecting cards with the marquee", () => {
    const selection = hitTestRect(scene, camera(), marqueeRect({ x: 0, y: 0 }, { x: 160, y: 120 }));
    expect(selection.cards.map((entry) => entry.cardId)).toEqual(["c1", "c2"]);
    expect(selection.sections).toHaveLength(0);
    expect(selection.portals).toHaveLength(0);
    expect(rectSelectionKeys(selection)).toEqual(selection.cards.map((entry) => entry.instanceKey));
  });

  it("should map the marquee through the camera zoom", () => {
    const selection = hitTestRect(scene, camera(2), { x: 0, y: 0, width: 320, height: 240 });
    expect(selection.cards.map((entry) => entry.cardId)).toEqual(["c1", "c2"]);
  });

  it("should return every kind for a full-board marquee", () => {
    const selection = hitTestRect(scene, camera(), { x: 0, y: 0, width: 1000, height: 500 });
    expect(selection.cards.map((entry) => entry.cardId).sort()).toEqual([
      "c1",
      "c2",
      "c3",
      "e1a",
      "e1b",
      "n1",
    ]);
    expect(selection.sections.map((entry) => entry.sectionId)).toEqual(["s1"]);
    expect(selection.edges.map((entry) => entry.edgeId)).toEqual(["e1"]);
    expect(selection.portals.map((entry) => entry.cardId)).toEqual(["p"]);
    expect(selection.portals[0]?.boardId).toBe("a");
    expect(selection.portals[0]?.path).toEqual(["a"]);
  });

  it("should ignore hidden instances and non-finite marquees", () => {
    const tiny = buildScene({ ...sceneInput, camera: camera(0.05) });
    const hidden = hitTestRect(tiny, camera(0.05), { x: 0, y: 0, width: 1000, height: 1000 });
    expect(hidden.cards).toHaveLength(0);
    expect(hidden.sections).toHaveLength(0);
    expect(hidden.edges).toHaveLength(0);
    expect(hidden.portals).toHaveLength(0);
    expect(hitTestRect(scene, camera(), { x: Number.NaN, y: 0, width: 10, height: 10 })).toEqual({
      cards: [],
      sections: [],
      edges: [],
      portals: [],
    });
  });
});

describe("selectionBounds", () => {
  it("should union card and section boxes in page space", () => {
    const bounds = selectionBounds(scene, [card("c1").key, must(scene.sections[0]).key]);
    expect(bounds).toEqual({ x: 0, y: 0, width: 500, height: 150 });
  });

  it("should include edges, portals and unknown keys", () => {
    const bounds = selectionBounds(scene, [
      must(scene.portals[0]).key,
      must(scene.edges[0]).key,
      "missing",
    ]);
    expect(bounds).not.toBeNull();
    expect(bounds?.x).toBe(50);
    expect(bounds?.y).toBe(0);
    expect(bounds?.width).toBeCloseTo(850);
    expect(bounds?.height).toBeCloseTo(341);
  });

  it("should return null when nothing resolves", () => {
    expect(selectionBounds(scene, [])).toBeNull();
    expect(selectionBounds(scene, ["nope"])).toBeNull();
  });
});

describe("drag", () => {
  it("should record board transforms and canonical ids", () => {
    const session = beginDrag({
      scene,
      camera: camera(2),
      screenPoint: { x: 20, y: 20 },
      instanceKeys: [card("c1").key, card("n1").key, "missing"],
    });
    expect(session.startPage).toEqual({ x: 10, y: 10 });
    expect(session.items).toHaveLength(2);
    expect(session.boardIds).toEqual(["a", "b"]);
    expect(session.cardIds).toEqual(["c1", "n1"]);
    expect(session.sectionIds).toEqual([]);
    const nested = must(session.items.find((item) => item.cardId === "n1"));
    expect(nested.transform.scale).toBeCloseTo(0.5);
    expect(nested.startLocal).toEqual({ x: 0, y: 0, width: 600, height: 400 });
  });

  it("should map a page delta into canonical board coordinates", () => {
    const session = beginDrag({
      scene,
      camera: camera(2),
      screenPoint: { x: 20, y: 20 },
      instanceKeys: [card("c1").key, card("n1").key],
    });
    const moves = dragDelta(session, { x: 60, y: 30 });
    expect(moves).toHaveLength(2);
    const root = must(moves.find((move) => move.boardId === "a"));
    expect(root.cardId).toBe("c1");
    expect(root.x).toBeCloseTo(50);
    expect(root.y).toBeCloseTo(20);
    const nested = must(moves.find((move) => move.boardId === "b"));
    expect(nested.cardId).toBe("n1");
    expect(nested.x).toBeCloseTo(100);
    expect(nested.y).toBeCloseTo(40);
  });

  it("should drag sections and portal frames by canonical card id", () => {
    const session = beginDrag({
      scene,
      camera: camera(),
      screenPoint: { x: 0, y: 0 },
      instanceKeys: [must(scene.sections[0]).key, must(scene.portals[0]).key],
    });
    expect(session.sectionIds).toEqual(["s1"]);
    expect(session.cardIds).toEqual(["p"]);
    const moves = dragDelta(session, { x: 10, y: -5 });
    expect(moves).toHaveLength(2);
    const section = must(moves.find((move) => move.sectionId === "s1"));
    expect(section).toMatchObject({ boardId: "a", x: 310, y: -5 });
    const portal = must(moves.find((move) => move.cardId === "p"));
    expect(portal).toMatchObject({ boardId: "a", x: 610, y: -5 });
  });

  it("should flip the delta for a negative board scale", () => {
    const session: DragSession = {
      startPage: { x: 0, y: 0 },
      startScreen: { x: 0, y: 0 },
      camera: camera(),
      items: [
        {
          instanceKey: "k",
          kind: "card",
          boardId: "a",
          boardKey: "b:",
          path: ["a"],
          cardId: "c",
          sectionId: null,
          transform: { scale: -0.5, x: 0, y: 0 },
          startLocal: { x: 0, y: 0, width: 10, height: 10 },
        },
      ],
      boardIds: ["a"],
      cardIds: ["c"],
      sectionIds: [],
    };
    expect(dragDelta(session, { x: 10, y: 10 })).toEqual([
      { boardId: "a", cardId: "c", x: -20, y: -20 },
    ]);
  });

  it("should ignore unusable input", () => {
    const session = beginDrag({
      scene,
      camera: camera(),
      screenPoint: { x: 0, y: 0 },
      instanceKeys: [must(scene.edges[0]).key, scene.root.key],
    });
    expect(session.items).toHaveLength(0);
    expect(session.boardIds).toEqual([]);
    expect(dragDelta(session, { x: 10, y: 10 })).toEqual([]);
    expect(dragDelta(session, { x: Number.NaN, y: 0 })).toEqual([]);
  });
});

describe("resizeFromHandle", () => {
  const at = (handle: "nw" | "ne" | "se" | "sw" | "n" | "s" | "e" | "w", x = 20, y = 10) =>
    resizeFromHandle({
      scene,
      camera: camera(2),
      instanceKey: card("c1").key,
      handle,
      screenDelta: { x, y },
    });

  it("should resize from each corner through camera zoom and board scale", () => {
    expect(at("se")).toEqual({ x: 0, y: 0, width: 110, height: 85 });
    expect(at("nw")).toEqual({ x: 10, y: 5, width: 90, height: 75 });
    expect(at("ne")).toEqual({ x: 0, y: 5, width: 110, height: 75 });
    expect(at("sw")).toEqual({ x: 10, y: 0, width: 90, height: 85 });
  });

  it("should resize from edge handles", () => {
    expect(at("n")).toEqual({ x: 0, y: 5, width: 100, height: 75 });
    expect(at("s")).toEqual({ x: 0, y: 0, width: 100, height: 85 });
    expect(at("e")).toEqual({ x: 0, y: 0, width: 110, height: 80 });
    expect(at("w")).toEqual({ x: 10, y: 0, width: 90, height: 80 });
  });

  it("should divide by a nested portal scale", () => {
    const rect = resizeFromHandle({
      scene,
      camera: camera(),
      instanceKey: card("n1").key,
      handle: "se",
      screenDelta: { x: 20, y: 10 },
    });
    expect(rect).toEqual({ x: 0, y: 0, width: 640, height: 420 });
  });

  it("should clamp to the minimum size", () => {
    const rect = at("se", -400, -400);
    expect(rect.width).toBe(1);
    expect(rect.height).toBe(1);
  });

  it("should shape a resize as a canonical move", () => {
    expect(
      resizeMove({
        scene,
        camera: camera(2),
        instanceKey: card("c1").key,
        handle: "se",
        screenDelta: { x: 20, y: 10 },
      }),
    ).toEqual({ boardId: "a", cardId: "c1", x: 0, y: 0, width: 110, height: 85 });
    expect(
      resizeMove({
        scene,
        camera: camera(),
        instanceKey: must(scene.sections[0]).key,
        handle: "e",
        screenDelta: { x: 10, y: 0 },
      }),
    ).toEqual({ boardId: "a", sectionId: "s1", x: 300, y: 0, width: 210, height: 150 });
    expect(
      resizeMove({
        scene,
        camera: camera(),
        instanceKey: "nope",
        handle: "se",
        screenDelta: { x: 10, y: 10 },
      }),
    ).toBeNull();
  });

  it("should return an empty rect for unknown instances", () => {
    expect(
      resizeFromHandle({
        scene,
        camera: camera(),
        instanceKey: "nope",
        handle: "se",
        screenDelta: { x: 10, y: 10 },
      }),
    ).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("distanceToEdge", () => {
  it("should measure a straight route", () => {
    const straight = edge({ x: 0, y: 0 }, { x: 100, y: 0 }, "straight");
    expect(distanceToEdge(straight, { x: 50, y: 0 })).toBeCloseTo(0);
    expect(distanceToEdge(straight, { x: 50, y: 7 })).toBeCloseTo(7);
    expect(distanceToEdge(straight, { x: -10, y: 0 })).toBeCloseTo(10);
    expect(distanceToEdge(straight, { x: 110, y: 0 })).toBeCloseTo(10);
  });

  it("should measure a step route along its elbow", () => {
    const step = edge({ x: 0, y: 0 }, { x: 100, y: 100 }, "step");
    expect(distanceToEdge(step, { x: 50, y: 50 })).toBeCloseTo(0);
    expect(distanceToEdge(step, { x: 40, y: 50 })).toBeCloseTo(10);
    expect(distanceToEdge(step, { x: 0, y: 50 })).toBeCloseTo(50);
    expect(distanceToEdge(step, { x: 100, y: 50 })).toBeCloseTo(50);
  });

  it("should measure a bezier route from its curve, not its chord", () => {
    const flat = edge({ x: 0, y: 0 }, { x: 100, y: 0 }, "bezier");
    expect(distanceToEdge(flat, { x: 50, y: 10 })).toBeCloseTo(10);

    const vertical = edge({ x: 0, y: 0 }, { x: 0, y: 100 }, "bezier");
    // Symmetric control points cancel at the midpoint: the curve passes x=0.
    expect(distanceToEdge(vertical, { x: 0, y: 50 })).toBeCloseTo(0);
    expect(distanceToEdge(vertical, { x: 0, y: 50 })).toBeLessThan(
      distanceToEdge(vertical, { x: 60, y: 50 }),
    );
  });

  it("should flatten every route deterministically", () => {
    expect(edgeRoutePolyline({ x: 0, y: 0 }, { x: 10, y: 0 }, "straight")).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(edgeRoutePolyline({ x: 0, y: 0 }, { x: 10, y: 10 }, "step")).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 10 },
      { x: 10, y: 10 },
    ]);
    expect(edgeRoutePolyline({ x: 0, y: 0 }, { x: 10, y: 0 }, "bezier", 4)).toHaveLength(5);
  });

  it("should return infinity for non-finite points", () => {
    const straight = edge({ x: 0, y: 0 }, { x: 100, y: 0 }, "straight");
    expect(distanceToEdge(straight, { x: Number.NaN, y: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});
