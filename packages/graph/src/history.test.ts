import { describe, expect, it } from "vitest";
import {
  compareHistoryStates,
  type HistoryPoint,
  type HistoryState,
  historyFrontier,
  historyLabel,
  historyPoint,
  historyRestoreSummary,
} from "./history.js";

const point: HistoryPoint = historyPoint(
  { peer: "1", counter: 4, length: 2, lamport: 7, timestamp: 1_700_000_000, origin: "struct:x" },
  false,
);

function state(overrides: Partial<HistoryState> = {}): HistoryState {
  return {
    boards: [],
    cards: [],
    sections: [],
    edges: [],
    tags: [],
    placements: [],
    titles: {},
    ...overrides,
  };
}

describe("historyLabel", () => {
  it.each([
    ["struct:create-card", "Added card"],
    ["struct:move-cards", "Moved cards"],
    ["struct:delete-board", "Deleted board"],
    ["struct:rename-section", "Renamed section"],
    ["struct:board-color", "Changed board color"],
    ["struct:write-rich-text", "Wrote card text"],
    ["sys:init", "Workspace created"],
    ["undo", "Undo"],
    ["struct:history-restore", "Restored an earlier point"],
    ["loroSyncPlugin:body", "Typed in a card"],
    ["text:body", "Typed in a card"],
    ["template:research", "Started from a template"],
    ["obsidian:vault", "Imported an Obsidian vault"],
  ])("%s reads as %s", (origin, label) => {
    expect(historyLabel(origin)).toBe(label);
  });

  it("names a change with no origin rather than leaving it blank", () => {
    expect(historyLabel(null)).toBe("Changed the workspace");
    expect(historyLabel("   ")).toBe("Changed the workspace");
  });
});

describe("historyPoint", () => {
  it("reads the timestamp as milliseconds and keeps the change id", () => {
    expect(point.id).toBe("1@4");
    expect(point.at).toBe(1_700_000_000_000);
    expect(point.length).toBe(2);
  });

  it("reports no time for a change that was written without a stamp", () => {
    const unstamped = historyPoint({
      peer: "1",
      counter: 0,
      length: 1,
      lamport: 0,
      timestamp: 0,
      origin: null,
    });
    expect(unstamped.at).toBeNull();
  });

  it("ends at the change's last operation, not its first", () => {
    expect(historyFrontier(point)).toEqual([{ peer: "1", counter: 5 }]);
  });
});

describe("compareHistoryStates", () => {
  it("counts what a restore brings back, removes and keeps", () => {
    const now = state({
      cards: ["a", "b"],
      boards: ["b1"],
      placements: ["b1/a", "b1/b"],
      titles: { a: "Alpha", b: "Beta" },
    });
    const then = state({
      cards: ["a", "c"],
      boards: ["b1"],
      placements: ["b1/a", "b1/c"],
      titles: { a: "Alpha", c: "Gamma" },
    });
    const preview = compareHistoryStates(now, then, point);
    expect(preview.restored.cards).toBe(1);
    expect(preview.removed.cards).toBe(1);
    expect(preview.kept.cards).toBe(1);
    expect(preview.restoredTitles).toEqual(["Gamma"]);
    expect(preview.removedTitles).toEqual(["Beta"]);
    expect(preview.empty).toBe(false);
  });

  it("counts a card whose text differs on both sides as changed", () => {
    const now = state({ cards: ["a"], titles: { a: "Alpha" } });
    const then = state({ cards: ["a"], titles: { a: "Alpha, revised" } });
    const preview = compareHistoryStates(now, then, point);
    expect(preview.changed).toBe(1);
    expect(preview.empty).toBe(false);
  });

  it("says nothing would change when the point is the current document", () => {
    const same = state({ cards: ["a"], titles: { a: "Alpha" } });
    const preview = compareHistoryStates(same, same, point);
    expect(preview.empty).toBe(true);
    expect(preview.summary).toContain("Nothing would change");
  });

  it("states the counts and the undo in one sentence", () => {
    const preview = compareHistoryStates(
      state({ cards: ["a", "b"], titles: { a: "Alpha", b: "Beta" } }),
      state({ cards: ["a"], titles: { a: "Alpha" } }),
      point,
    );
    expect(preview.summary).toContain("removes 1 card");
    expect(preview.summary).toContain("for everyone");
    expect(preview.summary).toContain("Undo puts it back");
  });
});

describe("historyRestoreSummary", () => {
  it("names boards as well as cards", () => {
    expect(
      historyRestoreSummary({
        restored: { boards: 1, cards: 3, sections: 0, edges: 0, tags: 0, placements: 3 },
        removed: { boards: 0, cards: 0, sections: 0, edges: 0, tags: 0, placements: 0 },
        changed: 0,
      }),
    ).toContain("brings back 3 cards, restores 1 board");
  });

  it("falls back to a plain sentence when only untitled records move", () => {
    expect(
      historyRestoreSummary({
        restored: { boards: 0, cards: 0, sections: 1, edges: 0, tags: 0, placements: 0 },
        removed: { boards: 0, cards: 0, sections: 0, edges: 0, tags: 0, placements: 0 },
        changed: 0,
      }),
    ).toContain("rewrites the workspace");
  });
});
