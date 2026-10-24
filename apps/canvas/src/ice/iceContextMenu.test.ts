import { describe, expect, it } from "vitest";
import {
  CONNECTOR_PART_PREFIX,
  connectorIdFromPart,
  contextMenuStateFor,
  MENU_SECTIONS,
  type MenuCamera,
  type MenuSectionId,
  type MenuTarget,
  type MenuTargetInput,
  menuItemsAvailable,
  menuTargetFromPick,
} from "./iceContextMenu";

const CARD = 1;
const SECTION = 2;
const PIN = 3;
const MAT = 4;
const EDGE = 5;

function input(overrides: Partial<MenuTargetInput> = {}): MenuTargetInput {
  return {
    pick: null,
    slots: new Map([[CARD, { cardId: "card-1", boardId: "board-1" }]]),
    pins: new Map([[PIN, "pin-1"]]),
    boards: new Map([[MAT, { boardId: "board-nested" }]]),
    sections: new Map([[SECTION, { sectionId: "section-1", boardId: "board-1" }]]),
    edges: new Map([[EDGE, { edgeId: "edge-1", boardId: "board-1" }]]),
    ...overrides,
  };
}

describe("connectorIdFromPart", () => {
  it("reads the id after the prefix", () => {
    expect(connectorIdFromPart(`${CONNECTOR_PART_PREFIX}c-7`)).toBe("c-7");
    expect(CONNECTOR_PART_PREFIX).toBe("connector:");
  });

  it("rejects absent, empty and unrelated parts", () => {
    expect(connectorIdFromPart(undefined)).toBeNull();
    expect(connectorIdFromPart(CONNECTOR_PART_PREFIX)).toBeNull();
    expect(connectorIdFromPart("header")).toBeNull();
    expect(connectorIdFromPart("connectors:x")).toBeNull();
  });
});

describe("menuTargetFromPick", () => {
  it("returns null when nothing was picked", () => {
    expect(menuTargetFromPick(input())).toBeNull();
  });

  it("maps a card instance to a node on its board", () => {
    expect(menuTargetFromPick(input({ pick: { entity: CARD, type: "suite.card" } }))).toEqual({
      kind: "node",
      cardId: "card-1",
      boardId: "board-1",
    });
  });

  it("maps a connector part to a connector on that card", () => {
    expect(
      menuTargetFromPick(
        input({ pick: { entity: CARD, type: "suite.card", part: "connector:c-2" } }),
      ),
    ).toEqual({
      kind: "connector",
      cardId: "card-1",
      connectorId: "c-2",
      boardId: "board-1",
    });
  });

  it("keeps the card when a part is not a connector handle", () => {
    expect(
      menuTargetFromPick(input({ pick: { entity: CARD, type: "suite.card", part: "resize:se" } })),
    ).toEqual({ kind: "node", cardId: "card-1", boardId: "board-1" });
  });

  it("keeps the card when the connector part carries no id", () => {
    expect(
      menuTargetFromPick(
        input({ pick: { entity: CARD, type: "suite.card", part: CONNECTOR_PART_PREFIX } }),
      ),
    ).toEqual({ kind: "node", cardId: "card-1", boardId: "board-1" });
  });

  it("lets a card win over the section under it", () => {
    const overlapping = input({
      pick: { entity: CARD, type: "suite.card" },
      sections: new Map([
        [SECTION, { sectionId: "section-1", boardId: "board-1" }],
        [CARD, { sectionId: "section-under-card", boardId: "board-1" }],
      ]),
    });
    expect(menuTargetFromPick(overlapping)).toEqual({
      kind: "node",
      cardId: "card-1",
      boardId: "board-1",
    });
  });

  it("maps a pin entity to a pin, with no board of its own", () => {
    expect(menuTargetFromPick(input({ pick: { entity: PIN, type: "suite.pin" } }))).toEqual({
      kind: "pin",
      pinId: "pin-1",
      boardId: null,
    });
  });

  it("maps a board mat to the board it draws", () => {
    expect(menuTargetFromPick(input({ pick: { entity: MAT, type: "desk.minimat" } }))).toEqual({
      kind: "board",
      boardId: "board-nested",
    });
  });

  it("maps a section and an edge", () => {
    expect(menuTargetFromPick(input({ pick: { entity: SECTION, type: "suite.section" } }))).toEqual(
      { kind: "section", sectionId: "section-1", boardId: "board-1" },
    );
    expect(menuTargetFromPick(input({ pick: { entity: EDGE, type: "suite.edge" } }))).toEqual({
      kind: "edge",
      edgeId: "edge-1",
      boardId: "board-1",
    });
  });

  it("falls back to the canvas for an unknown entity", () => {
    expect(menuTargetFromPick(input({ pick: { entity: 999, type: "desk.note" } }))).toEqual({
      kind: "canvas",
      boardId: null,
    });
  });

  it("falls back to the canvas for a connector part on an unknown entity", () => {
    expect(
      menuTargetFromPick(
        input({ pick: { entity: 999, type: "suite.card", part: "connector:c-2" } }),
      ),
    ).toEqual({ kind: "canvas", boardId: null });
  });
});

const CAMERA: MenuCamera = { x: 100, y: 50, zoom: 0.5 };
const CONTAINER = { left: 40, top: 20, width: 800, height: 600 };

describe("contextMenuStateFor", () => {
  it("keeps the client point and maps the board point through a camera and zoom", () => {
    const state = contextMenuStateFor({
      client: { x: 240, y: 120 },
      container: CONTAINER,
      camera: CAMERA,
      target: { kind: "canvas", boardId: null },
    });
    // screen (200, 100) → world ((200-100)/0.5, (100-50)/0.5).
    expect(state).toEqual({
      x: 240,
      y: 120,
      kind: "canvas",
      flowPosition: { x: 200, y: 100 },
    });
  });

  it("is the container-relative point under an identity camera", () => {
    const state = contextMenuStateFor({
      client: { x: 310, y: 210 },
      container: CONTAINER,
      camera: { x: 0, y: 0, zoom: 1 },
      target: null,
    });
    expect(state.flowPosition).toEqual({ x: 270, y: 190 });
  });

  it("degrades to a zero-origin container and identity camera when geometry is missing", () => {
    const state = contextMenuStateFor({
      client: { x: 300, y: 200 },
      container: null,
      camera: null,
      target: null,
    });
    expect(state).toEqual({
      x: 300,
      y: 200,
      kind: "canvas",
      flowPosition: { x: 300, y: 200 },
    });
  });

  it("treats a non-positive zoom as 1 and a non-finite client point as the origin", () => {
    const zoomed = contextMenuStateFor({
      client: { x: 10, y: 10 },
      container: CONTAINER,
      camera: { x: 0, y: 0, zoom: 0 },
      target: null,
    });
    expect(zoomed.flowPosition).toEqual({ x: -30, y: -10 });

    const degenerate = contextMenuStateFor({
      client: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      container: CONTAINER,
      camera: CAMERA,
      target: null,
    });
    expect(degenerate.x).toBe(0);
    expect(degenerate.y).toBe(0);
    expect(Number.isFinite(degenerate.flowPosition?.x)).toBe(true);
    expect(Number.isFinite(degenerate.flowPosition?.y)).toBe(true);
  });

  it("maps every target kind onto the shared menu's kinds", () => {
    const geometry = { client: { x: 100, y: 100 }, container: CONTAINER, camera: CAMERA };

    expect(
      contextMenuStateFor({
        ...geometry,
        target: { kind: "node", cardId: "card-1", boardId: "board-1" },
      }),
    ).toEqual({
      x: 100,
      y: 100,
      kind: "node",
      nodeId: "card-1",
      flowPosition: { x: -80, y: 60 },
    });

    expect(
      contextMenuStateFor({
        ...geometry,
        target: {
          kind: "connector",
          cardId: "card-1",
          connectorId: "c-2",
          boardId: "board-1",
        },
      }),
    ).toEqual({
      x: 100,
      y: 100,
      kind: "connector",
      nodeId: "card-1",
      connectorId: "c-2",
      flowPosition: { x: -80, y: 60 },
    });

    expect(
      contextMenuStateFor({
        ...geometry,
        target: { kind: "section", sectionId: "section-1", boardId: "board-1" },
      }),
    ).toEqual({
      x: 100,
      y: 100,
      kind: "section",
      sectionId: "section-1",
      flowPosition: { x: -80, y: 60 },
    });

    expect(
      contextMenuStateFor({
        ...geometry,
        target: { kind: "edge", edgeId: "edge-1", boardId: "board-1" },
      }),
    ).toEqual({
      x: 100,
      y: 100,
      kind: "edge",
      edgeId: "edge-1",
      flowPosition: { x: -80, y: 60 },
    });
  });

  it("opens the canvas menu for pins, without forwarding their ids", () => {
    const geometry = { client: { x: 100, y: 100 }, container: CONTAINER, camera: CAMERA };
    const pin = contextMenuStateFor({
      ...geometry,
      target: { kind: "pin", pinId: "pin-1", boardId: null },
    });

    expect(pin).toEqual({ x: 100, y: 100, kind: "canvas", flowPosition: { x: -80, y: 60 } });
    expect(pin.nodeId).toBeUndefined();
    expect(pin.sectionId).toBeUndefined();
  });

  it("opens the frame menu for a board mat, named by its board id", () => {
    const menu = contextMenuStateFor({
      client: { x: 100, y: 100 },
      container: CONTAINER,
      camera: CAMERA,
      target: { kind: "board", boardId: "board-nested" },
    });

    expect(menu).toEqual({
      x: 100,
      y: 100,
      kind: "section",
      sectionId: "board-nested",
      flowPosition: { x: -80, y: 60 },
    });
  });

  it("opens the canvas menu when there is no target", () => {
    expect(
      contextMenuStateFor({
        client: { x: 5, y: 6 },
        container: CONTAINER,
        camera: CAMERA,
        target: null,
      }),
    ).toEqual({ x: 5, y: 6, kind: "canvas", flowPosition: { x: -270, y: -128 } });
  });
});

describe("menuItemsAvailable", () => {
  const targetOf = (kind: MenuTarget["kind"]): MenuTarget => ({ kind, boardId: "board-1" });

  it("offers nothing without a target", () => {
    expect(menuItemsAvailable(null)).toEqual([]);
  });

  it("offers creation, layout and share on empty canvas", () => {
    expect(menuItemsAvailable(targetOf("canvas"))).toEqual([
      "create-card",
      "create-board",
      "arrange-fractally",
      "create-section",
      "share",
    ] satisfies MenuSectionId[]);
  });

  it("offers info, duplicate, move, remove, trash and connectors on a card", () => {
    expect(menuItemsAvailable(targetOf("node"))).toEqual([
      "info",
      "duplicate",
      "move",
      "remove",
      "trash",
      "connectors",
    ] satisfies MenuSectionId[]);
  });

  it("offers rename, colour, layer and trash on a section", () => {
    expect(menuItemsAvailable(targetOf("section"))).toEqual([
      "rename",
      "color",
      "layer",
      "trash",
    ] satisfies MenuSectionId[]);
  });

  it("offers description and delete on an edge", () => {
    expect(menuItemsAvailable(targetOf("edge"))).toEqual([
      "description",
      "delete",
    ] satisfies MenuSectionId[]);
  });

  it("offers reposition and delete on a connector", () => {
    expect(menuItemsAvailable(targetOf("connector"))).toEqual([
      "reposition",
      "delete",
    ] satisfies MenuSectionId[]);
  });

  it("offers the canvas sections for pins, because they open that menu", () => {
    expect(menuItemsAvailable(targetOf("pin"))).toEqual(menuItemsAvailable(targetOf("canvas")));
  });

  it("offers the frame entries on a board mat", () => {
    expect(menuItemsAvailable(targetOf("board"))).toEqual(["rename", "color", "layer", "trash"]);
  });

  it("publishes the same table it serves", () => {
    expect(MENU_SECTIONS.canvas).toBe(menuItemsAvailable(targetOf("canvas")));
    expect(MENU_SECTIONS.connector).toEqual(["reposition", "delete"]);
  });
});
