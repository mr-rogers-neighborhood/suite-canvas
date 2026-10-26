import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HistoryPanel } from "./HistoryPanel";
import { pointDetail, previewLines, relativeTime } from "./historyFormat";

/** A workspace with a few committed steps, so the list has older points. */
function seeded(): { workspace: WorkspaceDocument; boardId: string; before: string } {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setTitleText("c1", "First note");
  const before = workspace.listHistoryPoints()[0]?.id ?? "";
  workspace.createCard({ id: "c2", boardId: board.id, position: { x: 320, y: 0 } });
  workspace.setTitleText("c2", "Second note");
  return { workspace, boardId: board.id, before };
}

describe("HistoryPanel", () => {
  it("lists the saved points newest first and marks the current one", () => {
    const { workspace } = seeded();
    render(<HistoryPanel workspace={workspace} now={Date.now()} />);
    const rows = within(screen.getByTestId("history-points")).getAllByRole("button");
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]?.getAttribute("aria-current")).toBe("true");
    expect(rows[1]?.getAttribute("aria-current")).toBeNull();
  });

  it("says what a restore would do before it happens", () => {
    const { workspace, before } = seeded();
    render(<HistoryPanel workspace={workspace} now={Date.now()} />);
    fireEvent.click(screen.getByTestId(`history-point-${before}`));
    const preview = screen.getByTestId("history-preview");
    expect(within(preview).getByTestId("history-preview-summary").textContent).toContain(
      "removes 1 card",
    );
    expect(within(preview).getByTestId("history-preview-summary").textContent).toContain(
      "Undo puts it back",
    );
    expect(within(preview).getByTestId("history-preview-lines").textContent).toContain(
      "Second note",
    );
  });

  it("restores the point, then offers the undo that puts the work back", () => {
    const { workspace, before } = seeded();
    render(<HistoryPanel workspace={workspace} now={Date.now()} />);
    fireEvent.click(screen.getByTestId(`history-point-${before}`));
    fireEvent.click(screen.getByTestId("history-restore"));

    expect(workspace.getCard("c2")).toBeUndefined();
    expect(screen.getByTestId("history-restored").textContent).toContain("Undo");

    fireEvent.click(screen.getByTestId("history-undo"));
    expect(workspace.getCard("c2")).toBeDefined();
    expect(screen.queryByTestId("history-restored")).toBeNull();
  });

  it("refuses to restore the point the workspace is already at", () => {
    const { workspace } = seeded();
    render(<HistoryPanel workspace={workspace} now={Date.now()} />);
    const [newest] = within(screen.getByTestId("history-points")).getAllByRole("button");
    if (newest) fireEvent.click(newest);
    expect(screen.queryByTestId("history-preview")).toBeNull();
  });

  it("closes only when the host asked for a close button", () => {
    const { workspace } = seeded();
    const { unmount } = render(<HistoryPanel workspace={workspace} now={Date.now()} />);
    expect(screen.queryByTestId("history-close")).toBeNull();
    unmount();

    let closed = false;
    render(<HistoryPanel workspace={workspace} now={Date.now()} onClose={() => (closed = true)} />);
    fireEvent.click(screen.getByTestId("history-close"));
    expect(closed).toBe(true);
  });

  it("cancels a preview without writing anything", () => {
    const { workspace, before } = seeded();
    render(<HistoryPanel workspace={workspace} now={Date.now()} />);
    fireEvent.click(screen.getByTestId(`history-point-${before}`));
    fireEvent.click(screen.getByTestId("history-cancel"));
    expect(screen.queryByTestId("history-preview")).toBeNull();
    expect(workspace.getCard("c2")).toBeDefined();
  });
});

describe("historyFormat", () => {
  const now = Date.UTC(2026, 4, 3, 12, 0, 0);

  it("reads a time relative to the injected clock", () => {
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 12 * 60_000, now)).toBe("12 mins ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe("yesterday");
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe("4 days ago");
    expect(relativeTime(null, now)).toBe("time unknown");
  });

  it("keeps a date for anything older than a week", () => {
    expect(relativeTime(now - 40 * 86_400_000, now)).toMatch(/^on /u);
  });

  it("describes a point by what it wrote", () => {
    const point = {
      id: "1@0",
      peer: "1",
      counter: 0,
      length: 3,
      lamport: 0,
      at: now,
      origin: "struct:create-card",
      label: "Added card",
      current: false,
    };
    expect(pointDetail(point)).toBe("3 operations \u00b7 struct:create-card");
    expect(pointDetail({ ...point, current: true })).toBe("This is the workspace now");
  });

  it("lists what comes back and what goes", () => {
    const preview = {
      point: {
        id: "1@0",
        peer: "1",
        counter: 0,
        length: 1,
        lamport: 0,
        at: now,
        origin: null,
        label: "x",
        current: false,
      },
      restored: { boards: 0, cards: 1, sections: 0, edges: 0, tags: 0, placements: 1 },
      removed: { boards: 0, cards: 2, sections: 1, edges: 0, tags: 0, placements: 2 },
      kept: { boards: 0, cards: 3, sections: 0, edges: 0, tags: 0, placements: 3 },
      changed: 1,
      restoredTitles: ["Old note"],
      removedTitles: ["New note", "Later note"],
      empty: false,
      summary: "Restoring reverts",
    };
    const lines = previewLines(preview).map((line) => line.text);
    expect(lines).toContain("1 card come back: Old note");
    expect(lines).toContain("2 cards removed: New note, Later note");
    expect(lines).toContain("1 card rewritten");
    expect(lines).toContain("1 section removed");
  });

  it("says nothing would change when no count moved", () => {
    const preview = {
      point: {
        id: "1@0",
        peer: "1",
        counter: 0,
        length: 1,
        lamport: 0,
        at: now,
        origin: null,
        label: "x",
        current: false,
      },
      restored: { boards: 0, cards: 0, sections: 0, edges: 0, tags: 0, placements: 0 },
      removed: { boards: 0, cards: 0, sections: 0, edges: 0, tags: 0, placements: 0 },
      kept: { boards: 0, cards: 0, sections: 0, edges: 0, tags: 0, placements: 0 },
      changed: 0,
      restoredTitles: [],
      removedTitles: [],
      empty: true,
      summary: "Nothing would change",
    };
    expect(previewLines(preview)[0]?.text).toBe("Nothing in the document would change");
  });
});
