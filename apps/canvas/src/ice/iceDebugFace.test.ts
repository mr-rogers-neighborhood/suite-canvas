import { describe, expect, it } from "vitest";

import { buildIceDebugSnapshot, EMPTY_OVERLAYS, type IceDebugSlot } from "./iceDebug";
import { publishCardFaces } from "./suiteCardFace";

/**
 * What the dev snapshot can see of a face (ADR-0043 §2).
 *
 * A GPU sheet has no DOM to read back, so the snapshot carries what the
 * projection published (the flow) and derives the band from the two facts it
 * already has: the card's own width and the camera's zoom. This is what
 * `scripts/ice-scenarios/face.mjs` asserts, so it is tested here rather than in
 * a browser.
 */
const CARD_WIDTH = 288;

function slot(cardId: string): IceDebugSlot {
  return {
    entity: 2,
    cardId,
    boardId: "board-1",
    local: { x: 0, y: 0, width: CARD_WIDTH, height: 240 },
    world: { x: 0, y: 0, width: CARD_WIDTH, height: 240 },
  };
}

function snapshotAt(zoom: number, cardId = "card-1") {
  return buildIceDebugSnapshot({
    at: 0,
    camera: { x: 0, y: 0, zoom },
    entered: [],
    boards: [],
    slots: [slot(cardId)],
    edges: [],
    overlays: EMPTY_OVERLAYS,
    peers: {},
    selection: [],
  });
}

describe("the snapshot's face", () => {
  it("should carry what the projection published, and the band that draws it", () => {
    publishCardFaces(new Map([["card-1", "▣ · A title · ⇄2\n\nThe body."]]));
    const [entry] = snapshotAt(1).slots;
    expect(entry?.face?.text).toBe("▣ · A title · ⇄2\n\nThe body.");
    // 288 world units at zoom 1 is 288 px: the full band.
    expect(entry?.face?.band).toBe("full");
  });

  it("should change the band at the ADR's thresholds", () => {
    publishCardFaces(new Map([["card-1", "▣ · A title"]]));
    const bandAt = (zoom: number) => snapshotAt(zoom).slots[0]?.face?.band;
    // 56 / 288 and 180 / 288 are the two crossings.
    expect(bandAt(0.19)).toBe("icon");
    expect(bandAt(0.2)).toBe("compact");
    expect(bandAt(0.62)).toBe("compact");
    expect(bandAt(0.63)).toBe("full");
  });

  it("should say nothing about a face the projection never published", () => {
    publishCardFaces(new Map());
    expect(snapshotAt(1, "card-unknown").slots[0]?.face).toBeUndefined();
  });
});
