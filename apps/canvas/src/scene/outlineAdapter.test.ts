import { PORTAL_BOARD_FIELD_ID, PORTAL_TYPE_ID } from "@suite/graph";
import { boardInstanceKey, buildScene, DEFAULT_PORTAL_CONFIG, type Scene } from "@suite/scene";
import { describe, expect, it } from "vitest";
import { sceneOutlineItems } from "./outlineAdapter";

function sceneFixture(): Scene {
  return buildScene({
    boards: [
      { id: "root", name: "Root" },
      { id: "target", name: "Target" },
    ],
    cards: [
      {
        id: "portal",
        primaryTypeId: PORTAL_TYPE_ID,
        properties: { [PORTAL_BOARD_FIELD_ID]: "target" },
      },
      { id: "child", primaryTypeId: "note", properties: {} },
      {
        id: "back",
        primaryTypeId: PORTAL_TYPE_ID,
        properties: { [PORTAL_BOARD_FIELD_ID]: "root" },
      },
    ],
    placements: [
      { boardId: "root", cardId: "portal", x: 0, y: 0, z: 0, width: 288, height: 256 },
      { boardId: "target", cardId: "child", x: 0, y: 0, z: 0 },
      { boardId: "target", cardId: "back", x: 300, y: 0, z: 1, width: 288, height: 256 },
    ],
    rootBoardId: "root",
    camera: { x: 0, y: 0, zoom: 1 },
    config: { portal: { ...DEFAULT_PORTAL_CONFIG, dwellMs: 0 } },
  });
}

describe("sceneOutlineItems", () => {
  it("should mirror boards, portals and cycle stops with their depths", () => {
    const items = sceneOutlineItems(sceneFixture());

    expect(items.map((item) => item.kind)).toEqual(["board", "portal", "board", "cycle"]);
    expect(items.map((item) => item.depth)).toEqual([0, 1, 1, 2]);
    expect(items[2]).toMatchObject({ cardCount: 2, expanded: true });
    expect(items[3]).toMatchObject({ cycle: true, hasChildren: false });
  });

  it("should hide descendants of a collapsed outline row", () => {
    const scene = sceneFixture();
    const items = sceneOutlineItems(scene, new Set([boardInstanceKey(["root"])]));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ expanded: false });
  });
});
