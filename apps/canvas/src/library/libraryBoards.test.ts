import { PORTAL_BOARD_FIELD_ID } from "@suite/graph";
import { describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { toBoardItems } from "./libraryBoards";

/**
 * A board as the library lists it.
 *
 * Two things are computed rather than read: how many cards sit on it, and which boards
 * hold a portal that opens it. Both are checked here, because a board row that gets
 * either wrong is a board the reader cannot find their way back to.
 */
function snapshotOf(input: {
  boards: Array<{ id: string; name: string; tags?: string[]; updatedAt?: number }>;
  /** Each card, the board it sits on, and the board its portal opens if it is one. */
  cards?: Array<{ on: string; portalTo?: string; deleted?: boolean }>;
}): WorkspaceSnapshot {
  return {
    boards: input.boards.map((board) => ({
      id: board.id,
      name: board.name,
      tags: board.tags ?? [],
      updatedAt: board.updatedAt ?? 0,
    })),
    cards: (input.cards ?? []).map((entry, index) => ({
      id: `card-${String(index)}`,
      deletedAt: entry.deleted === true ? 1 : undefined,
      properties: entry.portalTo === undefined ? {} : { [PORTAL_BOARD_FIELD_ID]: entry.portalTo },
    })),
    placements: (input.cards ?? []).map((entry, index) => ({
      cardId: `card-${String(index)}`,
      boardId: entry.on,
    })),
    edges: [],
    types: [],
    tags: [],
    sections: [],
    references: {},
  } as unknown as WorkspaceSnapshot;
}

describe("toBoardItems", () => {
  it("counts the cards placed on a board", () => {
    const items = toBoardItems(
      snapshotOf({
        boards: [
          { id: "home", name: "Home" },
          { id: "other", name: "Other" },
        ],
        cards: [{ on: "home" }, { on: "home" }, { on: "other" }],
      }),
    );

    expect(items.map((item) => [item.id, item.cardCount])).toEqual([
      ["home", 2],
      ["other", 1],
    ]);
  });

  it("counts a board with nothing on it as zero rather than as missing", () => {
    const items = toBoardItems(snapshotOf({ boards: [{ id: "home", name: "Home" }] }));

    expect(items[0]?.cardCount).toBe(0);
  });

  it("leaves a deleted card out of the count and out of the portal list", () => {
    const items = toBoardItems(
      snapshotOf({
        boards: [
          { id: "home", name: "Home" },
          { id: "new", name: "New" },
        ],
        cards: [
          { on: "home", portalTo: "new" },
          { on: "home", portalTo: "new", deleted: true },
        ],
      }),
    );

    expect(items.map((item) => [item.id, item.cardCount, item.boards])).toEqual([
      ["home", 1, []],
      ["new", 0, [{ id: "home", name: "Home" }]],
    ]);
  });

  it("names the boards whose portals open this one", () => {
    const items = toBoardItems(
      snapshotOf({
        boards: [
          { id: "home", name: "Home" },
          { id: "work", name: "Work" },
          { id: "new", name: "New" },
        ],
        cards: [
          { on: "home", portalTo: "new" },
          { on: "work", portalTo: "new" },
        ],
      }),
    );

    expect(items.find((item) => item.id === "new")?.boards).toEqual([
      { id: "home", name: "Home" },
      { id: "work", name: "Work" },
    ]);
  });

  it("carries a board's tags and the facet that filters to boards", () => {
    const items = toBoardItems(
      snapshotOf({
        boards: [{ id: "home", name: "Home", tags: ["tag-1"], updatedAt: 7 }],
      }),
    );

    expect(items[0]).toMatchObject({
      title: "Home",
      kind: "board",
      typeIds: ["board"],
      tagIds: ["tag-1"],
      updatedAt: 7,
    });
  });
});
