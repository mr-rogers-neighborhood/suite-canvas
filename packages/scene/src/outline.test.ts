import { PORTAL_BOARD_FIELD_ID, PORTAL_TYPE_ID } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { buildOutline, flattenOutline, outlineStops } from "./outline.js";
import { buildScene, DEFAULT_PORTAL_CONFIG } from "./scene.js";
import type { BuildSceneInput, PortalConfig, SceneCardInput } from "./types.js";

const note = (id: string): SceneCardInput => ({ id, primaryTypeId: "note", properties: {} });

const portalCard = (id: string, targetBoardId: string): SceneCardInput => ({
  id,
  primaryTypeId: PORTAL_TYPE_ID,
  properties: { [PORTAL_BOARD_FIELD_ID]: targetBoardId },
});

const eagerPortal = (overrides: Partial<PortalConfig> = {}): PortalConfig => ({
  ...DEFAULT_PORTAL_CONFIG,
  expansionScale: 0.1,
  collapseScale: 0.05,
  minScreenSize: 0,
  dwellMs: 0,
  padding: 1,
  ...overrides,
});

function chainInput(portalOverrides: Partial<PortalConfig> = {}): BuildSceneInput {
  return {
    boards: [
      { id: "a", name: "Board A" },
      { id: "b", name: "Board B" },
      { id: "c", name: "Board C" },
    ],
    cards: [portalCard("p1", "b"), note("na"), portalCard("p2", "c"), note("nb"), note("nc")],
    placements: [
      { boardId: "a", cardId: "p1", x: 0, y: 0, z: 0, width: 300, height: 200 },
      { boardId: "a", cardId: "na", x: 400, y: 0, z: 1 },
      { boardId: "b", cardId: "p2", x: 0, y: 0, z: 0, width: 300, height: 200 },
      { boardId: "b", cardId: "nb", x: 400, y: 0, z: 1 },
      { boardId: "c", cardId: "nc", x: 0, y: 0, z: 0 },
    ],
    rootBoardId: "a",
    camera: { x: 0, y: 0, zoom: 1 },
    config: { portal: eagerPortal(portalOverrides) },
  };
}

describe("buildOutline", () => {
  it("should alternate boards and portals down the scene", () => {
    const rows = buildOutline(buildScene(chainInput()));
    expect(rows).toHaveLength(1);
    const root = rows[0];
    expect(root?.kind).toBe("board");
    expect(root?.label).toBe("Board A");
    expect(root?.path).toEqual(["a"]);
    expect(root?.children).toHaveLength(1);
    const firstPortal = root?.children[0];
    expect(firstPortal?.kind).toBe("portal");
    expect(firstPortal?.label).toBe("Board B");
    expect(firstPortal?.boardId).toBe("b");
    expect(firstPortal?.expanded).toBe(true);
    const boardB = firstPortal?.children[0];
    expect(boardB?.kind).toBe("board");
    expect(boardB?.label).toBe("Board B");
    expect(boardB?.path).toEqual(["a", "b"]);
    const secondPortal = boardB?.children[0];
    expect(secondPortal?.kind).toBe("portal");
    expect(secondPortal?.children[0]?.label).toBe("Board C");
    expect(flattenOutline(rows)).toHaveLength(5);
    expect(outlineStops(rows)).toHaveLength(0);
  });

  it("should mark a cycle as a leaf portal row", () => {
    const scene = buildScene({
      boards: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      cards: [portalCard("p1", "b"), portalCard("p2", "a")],
      placements: [
        { boardId: "a", cardId: "p1", x: 0, y: 0, z: 0, width: 300, height: 200 },
        { boardId: "b", cardId: "p2", x: 0, y: 0, z: 0, width: 300, height: 200 },
      ],
      rootBoardId: "a",
      camera: { x: 0, y: 0, zoom: 1 },
      config: { portal: eagerPortal() },
    });
    const rows = buildOutline(scene);
    const flat = flattenOutline(rows);
    expect(flat).toHaveLength(4);
    const cycleRow = flat[3];
    expect(cycleRow?.kind).toBe("portal");
    expect(cycleRow?.cycle).toBe(true);
    expect(cycleRow?.expanded).toBe(false);
    expect(cycleRow?.children).toHaveLength(0);
    expect(outlineStops(rows)).toHaveLength(1);
  });

  it("should mark a depth-capped portal", () => {
    const rows = buildOutline(buildScene(chainInput({ maxDepth: 1 })));
    const flat = flattenOutline(rows);
    expect(flat).toHaveLength(4);
    const capped = flat[3];
    expect(capped?.kind).toBe("portal");
    expect(capped?.depthCapped).toBe(true);
    expect(capped?.children).toHaveLength(0);
    expect(outlineStops(rows)).toHaveLength(1);
  });
});
