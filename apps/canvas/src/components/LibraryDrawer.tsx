import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LibraryTab } from "../store/useUiStore";

export interface LibraryItem {
  id: string;
  title: string;
  boards: Array<{ id: string; name: string }>;
}

export interface LibraryDrawerProps {
  open: boolean;
  tab: LibraryTab;
  counts: Record<LibraryTab, number>;
  inbox: LibraryItem[];
  cards: LibraryItem[];
  trash: LibraryItem[];
  onTab: (tab: LibraryTab) => void;
  onClose: () => void;
  onPlace: (cardId: string) => void;
  onCreateInInbox: () => void;
  onTrash: (cardId: string) => void;
  onRestore: (cardId: string) => void;
  onDeleteForever: (cardId: string) => void;
  onEmptyTrash: () => void;
  onGoToBoard: (boardId: string) => void;
  /** Pointer drop over the canvas, in client coordinates. */
  onDropAt: (cardId: string, point: { x: number; y: number }) => void;
}

const TABS: Array<{ id: LibraryTab; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "cards", label: "Cards" },
  { id: "trash", label: "Trash" },
];

const HOLD_THRESHOLD = 4;

export function LibraryDrawer({
  open,
  tab,
  counts,
  inbox,
  cards,
  trash,
  onTab,
  onClose,
  onPlace,
  onCreateInInbox,
  onTrash,
  onRestore,
  onDeleteForever,
  onEmptyTrash,
  onGoToBoard,
  onDropAt,
}: LibraryDrawerProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [hold, setHold] = useState<{ item: LibraryItem; x: number; y: number } | null>(null);
  const holdRef = useRef<{
    cardId: string;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setHold(null);
  }, [open]);

  // Pointer-based hold: the row lifts into a ghost that follows the cursor, and
  // dropping over the canvas places the card there.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = holdRef.current;
      if (!current) return;
      const far =
        Math.abs(event.clientX - current.startX) > HOLD_THRESHOLD ||
        Math.abs(event.clientY - current.startY) > HOLD_THRESHOLD;
      if (!far && !current.dragging) return;
      current.dragging = true;
      setHold((previous) =>
        previous ? { ...previous, x: event.clientX, y: event.clientY } : null,
      );
    };

    const up = (event: PointerEvent) => {
      const current = holdRef.current;
      holdRef.current = null;
      setHold(null);
      if (!current?.dragging) return;
      const canvas = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-testid="canvas-board"]');
      if (canvas) onDropAt(current.cardId, { x: event.clientX, y: event.clientY });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [onDropAt]);

  if (!open) return null;

  const items = tab === "inbox" ? inbox : tab === "cards" ? cards : trash;

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Library"
      data-testid="library-drawer"
      className="library-drawer"
    >
      <div className="flex items-center gap-1 border-b border-[var(--hairline)] px-2 py-1.5">
        <div role="tablist" aria-label="Library sections" className="flex items-center gap-1">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              data-testid={`library-tab-${entry.id}`}
              className="library-tab"
              data-active={tab === entry.id ? "true" : undefined}
              onClick={() => onTab(entry.id)}
            >
              {entry.label}
              <span className="tabular-nums text-[var(--ink-muted)]">{counts[entry.id]}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {tab === "inbox" ? (
            <button
              type="button"
              data-testid="library-new-card"
              className="library-action"
              onClick={onCreateInInbox}
            >
              New
            </button>
          ) : null}
          {tab === "trash" && trash.length > 0 ? (
            <button
              type="button"
              data-testid="library-empty-trash"
              className="library-action text-red-600"
              onClick={onEmptyTrash}
            >
              Empty trash
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Close library"
            className="library-action"
            onClick={onClose}
          >
            {"\u00d7"}
          </button>
        </div>
      </div>

      <div className="max-h-[46vh] overflow-y-auto p-1.5">
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-[var(--ink-muted)]">
            {tab === "inbox"
              ? "Nothing in the inbox. Cards you take off a board land here."
              : tab === "cards"
                ? "No cards yet."
                : "Trash is empty."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li
                key={item.id}
                data-testid={`library-item-${item.id}`}
                className="library-row"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  if ((event.target as HTMLElement).closest("button")) return;
                  // Keep the gesture from selecting text across the board.
                  event.preventDefault();
                  holdRef.current = {
                    cardId: item.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    dragging: false,
                  };
                  setHold({ item, x: event.clientX, y: event.clientY });
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px]">{item.title}</p>
                  {item.boards.length > 0 ? (
                    <p className="truncate text-[10px] text-[var(--ink-muted)]">
                      {item.boards.map((board) => board.name).join(" \u00b7 ")}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {tab === "trash" ? (
                    <>
                      <button
                        type="button"
                        className="library-action"
                        onClick={() => onRestore(item.id)}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="library-action text-red-600"
                        onClick={() => onDeleteForever(item.id)}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <>
                      {item.boards.length > 0 ? (
                        <button
                          type="button"
                          className="library-action"
                          onClick={() => onGoToBoard(item.boards[0]?.id ?? "")}
                        >
                          Open
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="library-action"
                        onClick={() => onPlace(item.id)}
                      >
                        Place
                      </button>
                      <button
                        type="button"
                        className="library-action text-red-600"
                        onClick={() => onTrash(item.id)}
                      >
                        Trash
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hold ? (
        <div
          aria-hidden="true"
          data-testid="library-hold-ghost"
          className="library-ghost"
          style={{ left: hold.x, top: hold.y }}
        >
          {hold.item.title}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
