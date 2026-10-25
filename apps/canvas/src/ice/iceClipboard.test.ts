import { describe, expect, it, vi } from "vitest";

import { capabilitiesForRole } from "./iceBridge";
import {
  applyClone,
  buildClipboard,
  clipboardText,
  type IceClipboardCard,
  type IceCloneWriter,
  planCopy,
  planDuplicate,
  planPaste,
  workspaceCloneWriter,
} from "./iceClipboard";

const writerCaps = capabilitiesForRole("editor");
const viewerCaps = capabilitiesForRole("viewer");

const card = (overrides: Partial<IceClipboardCard> = {}): IceClipboardCard => ({
  cardId: "card-a",
  boardId: "board-1",
  x: 100,
  y: 50,
  title: "A card",
  ...overrides,
});

/** A writer that records the calls a clone makes, so "one batch" is countable. */
function recordingWriter(): IceCloneWriter & {
  readonly batches: string[];
  readonly clones: Array<{ source: string; boardId: string; x: number; y: number }>;
} {
  const batches: string[] = [];
  const clones: Array<{ source: string; boardId: string; x: number; y: number }> = [];
  let minted = 0;
  return {
    batches,
    clones,
    batch(origin, fn) {
      batches.push(origin);
      return fn();
    },
    cloneCard(source, target) {
      clones.push({ source, boardId: target.boardId, x: target.x, y: target.y });
      minted += 1;
      return `${source}-copy-${minted}`;
    },
  };
}

describe("copying a selection", () => {
  it("should anchor a multi-selection on its top-left corner", () => {
    const clipboard = buildClipboard([
      card({ cardId: "a", x: 120, y: 80 }),
      card({ cardId: "b", x: 40, y: 200 }),
    ]);
    expect(clipboard?.anchor).toEqual({ x: 40, y: 80 });
    expect(clipboard?.cards.map((entry) => entry.cardId)).toEqual(["a", "b"]);
  });

  it("should keep one entry per card and drop a box that is not finite", () => {
    const clipboard = buildClipboard([
      card({ cardId: "a" }),
      card({ cardId: "a", x: 999 }),
      card({ cardId: "b", x: Number.NaN }),
    ]);
    expect(clipboard?.cards).toHaveLength(1);
    expect(clipboard?.cards[0]?.x).toBe(100);
  });

  it("should leave the buffer empty when the selection has nothing placeable", () => {
    expect(buildClipboard([])).toBeNull();
    expect(buildClipboard([card({ y: Number.POSITIVE_INFINITY })])).toBeNull();
  });

  it("should not copy for a seat that cannot paste", () => {
    expect(planCopy({ cards: [card()], capabilities: viewerCaps })).toBeNull();
    expect(planCopy({ cards: [card()], capabilities: writerCaps })?.cards).toHaveLength(1);
  });

  it("should hand the titles to the OS clipboard as plain text", () => {
    const clipboard = buildClipboard([
      card({ cardId: "a", title: "First" }),
      card({ cardId: "b", title: "Second" }),
    ]);
    expect(clipboard === null ? null : clipboardText(clipboard)).toBe("First\nSecond");
  });
});

describe("pasting a selection", () => {
  it("should re-base the group on the point and keep its arrangement", () => {
    const clipboard = buildClipboard([
      card({ cardId: "a", x: 100, y: 50 }),
      card({ cardId: "b", x: 300, y: 250 }),
    ]);
    if (clipboard === null) throw new Error("expected a clipboard");
    const plan = planPaste({
      clipboard,
      target: { boardId: "board-2", x: 1000, y: 700 },
      capabilities: writerCaps,
    });
    expect(plan.status).toBe("commit");
    if (plan.status !== "commit") return;
    expect(plan.write.cards).toEqual([
      { sourceCardId: "a", boardId: "board-2", x: 1000, y: 700 },
      { sourceCardId: "b", boardId: "board-2", x: 1200, y: 900 },
    ]);
  });

  it("should refuse a viewer and skip an empty buffer", () => {
    const clipboard = buildClipboard([card()]);
    if (clipboard === null) throw new Error("expected a clipboard");
    const denied = planPaste({
      clipboard,
      target: { boardId: "board-1", x: 0, y: 0 },
      capabilities: viewerCaps,
    });
    expect(denied).toEqual({ status: "denied", reason: "read-only" });

    const skipped = planPaste({
      clipboard: { cards: [], anchor: { x: 0, y: 0 } },
      target: { boardId: "board-1", x: 0, y: 0 },
      capabilities: writerCaps,
    });
    expect(skipped).toEqual({ status: "skip", reason: "empty-selection" });
  });

  it("should round to the bridge's coordinate precision", () => {
    const clipboard = buildClipboard([card({ x: 0.3333339, y: 0 })]);
    if (clipboard === null) throw new Error("expected a clipboard");
    const plan = planPaste({
      clipboard,
      target: { boardId: "board-1", x: 10.00049, y: 0.0006 },
      capabilities: writerCaps,
    });
    if (plan.status !== "commit") throw new Error("expected a commit");
    expect(plan.write.cards[0]?.x).toBe(10);
    expect(plan.write.cards[0]?.y).toBe(0.001);
  });
});

describe("duplicating a selection", () => {
  it("should offset every card on its own Board and keep the shape", () => {
    const plan = planDuplicate({
      cards: [card({ cardId: "a", boardId: "board-1" }), card({ cardId: "b", boardId: "board-2" })],
      capabilities: writerCaps,
    });
    if (plan.status !== "commit") throw new Error("expected a commit");
    expect(plan.write.cards).toEqual([
      { sourceCardId: "a", boardId: "board-1", x: 124, y: 74 },
      { sourceCardId: "b", boardId: "board-2", x: 124, y: 74 },
    ]);
  });

  it("should refuse a viewer", () => {
    expect(planDuplicate({ cards: [card()], capabilities: viewerCaps })).toEqual({
      status: "denied",
      reason: "read-only",
    });
  });
});

describe("applying a clone", () => {
  it("should clone every card inside one batch, so undo is one step", () => {
    const writer = recordingWriter();
    const created = applyClone(writer, {
      kind: "cloneCards",
      cards: [
        { sourceCardId: "a", boardId: "board-1", x: 10, y: 10 },
        { sourceCardId: "b", boardId: "board-1", x: 40, y: 10 },
      ],
    });
    expect(writer.batches).toEqual(["ice-bridge:clone"]);
    expect(writer.clones).toHaveLength(2);
    expect(created).toEqual(["a-copy-1", "b-copy-2"]);
  });

  it("should report only the cards the document agreed to copy", () => {
    const writer: IceCloneWriter = {
      batch: (_origin, fn) => fn(),
      cloneCard: (source) => (source === "gone" ? null : `${source}-copy`),
    };
    const created = applyClone(writer, {
      kind: "cloneCards",
      cards: [
        { sourceCardId: "gone", boardId: "board-1", x: 0, y: 0 },
        { sourceCardId: "here", boardId: "board-1", x: 0, y: 0 },
      ],
    });
    expect(created).toEqual(["here-copy"]);
  });

  it("should copy the card's own content and land it at the asked point", () => {
    // The reference adapter: `duplicateCard` copies the title/body trees, then
    // one `movePlacements` makes the destination exact — both in one batch.
    const calls: string[] = [];
    const doc = {
      duplicateCard: vi.fn((cardId: string) => {
        calls.push(`duplicate:${cardId}`);
        return { id: "copy-1" };
      }),
      movePlacements: vi.fn((boardId: string, moves: readonly { cardId: string }[]) => {
        calls.push(`move:${boardId}:${moves[0]?.cardId ?? ""}`);
      }),
      batch: <T>(origin: string, fn: () => T): T => {
        calls.push(`batch:${origin}`);
        return fn();
      },
    };
    const created = applyClone(
      workspaceCloneWriter(doc),
      {
        kind: "cloneCards",
        cards: [{ sourceCardId: "a", boardId: "board-2", x: 500, y: 400 }],
      },
      "ice-bridge:paste",
    );
    expect(created).toEqual(["copy-1"]);
    // One outer batch (the paste), and the document copies then places the
    // card inside it; `doc.batch` joins the duplicate's own batch.
    expect(calls).toEqual(["batch:ice-bridge:paste", "duplicate:a", "move:board-2:copy-1"]);
  });

  it("should survive a source the document refuses", () => {
    const doc = {
      duplicateCard: () => {
        throw new Error("Cannot duplicate a trashed card");
      },
      movePlacements: vi.fn(),
      batch: <T>(_origin: string, fn: () => T): T => fn(),
    };
    const created = applyClone(workspaceCloneWriter(doc), {
      kind: "cloneCards",
      cards: [{ sourceCardId: "trashed", boardId: "board-1", x: 0, y: 0 }],
    });
    expect(created).toEqual([]);
    expect(doc.movePlacements).not.toHaveBeenCalled();
  });
});
