import type { CardType } from "@suite/graph";
import { useEffect, useRef, useState } from "react";
import { LIBRARY_SEARCH_FOCUS_EVENT } from "../hooks/useLibrarySearch";
import { useUiStore } from "../store/useUiStore";

export interface DockProps {
  inboxCount: number;
  libraryOpen: boolean;
  types: CardType[];
  onToggleLibrary: () => void;
  onCreateCard: (typeId: string) => void;
  /** Plants an empty Board on the plane the reader is on (ADR-0039). */
  onCreateBoard?: () => void;
  onManageTypes: () => void;
  /** Types, fields and tags; hidden when the session cannot change the schema. */
  canManageSchema?: boolean;
  /** New cards and boards belong to a session that may create content. */
  canCreateContent?: boolean;
  /** Planting a Board also needs the board capability. */
  canCreateBoards?: boolean;
}

/**
 * Mac-style pill at the bottom of the canvas: the library on the left, card
 * creation on the right. Everything floats above the board and stays out of the
 * way of canvas gestures thanks to `pointer-events` on the container only.
 */
export function Dock({
  inboxCount,
  libraryOpen,
  types,
  onToggleLibrary,
  onCreateCard,
  onCreateBoard,
  onManageTypes,
  canManageSchema = true,
  canCreateContent = true,
  canCreateBoards = true,
}: DockProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);

  // Ctrl/Cmd+K is the one shortcut that reaches across the whole app: it opens
  // the library on Cards and asks the drawer to focus its search box.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The editor owns Mod-K while it is focused.
      if (event.defaultPrevented) return;
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      const ui = useUiStore.getState();
      ui.setLibraryOpen(true);
      ui.setLibraryTab("cards");
      window.dispatchEvent(new Event(LIBRARY_SEARCH_FOCUS_EVENT));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const create = (typeId: string) => {
    setMenuOpen(false);
    onCreateCard(typeId);
  };

  const createBoard = () => {
    setMenuOpen(false);
    onCreateBoard?.();
  };

  const offerNewBoard = canCreateContent && canCreateBoards;

  return (
    <div className="dock" role="toolbar" aria-label="Card library">
      <button
        type="button"
        aria-pressed={libraryOpen}
        aria-expanded={libraryOpen}
        data-testid="dock-library"
        className="dock-button"
        onClick={onToggleLibrary}
      >
        <span aria-hidden="true" className="text-[13px] leading-none">
          {"\u25a4"}
        </span>
        <span>Library</span>
        {inboxCount > 0 ? (
          <span className="dock-badge" data-testid="dock-inbox-count">
            {inboxCount}
          </span>
        ) : null}
      </button>

      <span className="dock-separator" aria-hidden="true" />

      <div className="relative" ref={menu}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid="dock-new-card"
          className="dock-button"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true" className="text-[13px] leading-none">
            +
          </span>
          <span>New card</span>
        </button>

        {menuOpen ? (
          <div
            role="menu"
            data-testid="dock-type-menu"
            className="absolute bottom-full left-1/2 mb-2 w-48 -translate-x-1/2 overflow-visible rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
          >
            {types.map((type) => (
              <button
                key={type.id}
                type="button"
                role="menuitem"
                data-testid={`dock-type-${type.id}`}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => create(type.id)}
              >
                <span aria-hidden="true" className="w-4 text-center text-[var(--ink-muted)]">
                  {type.glyph}
                </span>
                <span className="min-w-0 flex-1 truncate">{type.name}</span>
              </button>
            ))}

            {offerNewBoard ? (
              <>
                <div className="my-1 h-px bg-[var(--hairline)]" />
                {/* A Board is a frame that holds cards and other Boards; it is
                    planted on the plane, not attached to a card (ADR-0039). */}
                <button
                  type="button"
                  role="menuitem"
                  data-testid="dock-new-board"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={createBoard}
                >
                  <span aria-hidden="true" className="w-4 text-center text-[var(--ink-muted)]">
                    {"\u25a6"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">New board</span>
                </button>
              </>
            ) : null}

            {canManageSchema ? (
              <>
                <div className="my-1 h-px bg-[var(--hairline)]" />
                <button
                  type="button"
                  role="menuitem"
                  data-testid="dock-manage-types"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => {
                    setMenuOpen(false);
                    onManageTypes();
                  }}
                >
                  <span aria-hidden="true" className="w-4 text-center">
                    {"\u2699"}
                  </span>
                  <span>Manage types</span>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
