import type { Board, CardType } from "@suite/graph";
import { PORTAL_TYPE_ID } from "@suite/graph";
import { useEffect, useRef, useState } from "react";
import { PORTAL_GLYPH } from "../cards/portal";
import { LIBRARY_SEARCH_FOCUS_EVENT } from "../hooks/useLibrarySearch";
import { useUiStore } from "../store/useUiStore";

export interface DockProps {
  inboxCount: number;
  libraryOpen: boolean;
  types: CardType[];
  /** Every board, so the portal action can name its targets. */
  boards?: Board[];
  activeBoardId?: string | null;
  onToggleLibrary: () => void;
  onCreateCard: (typeId: string) => void;
  /** A sketch is a card of the built-in sketch type, created on demand. */
  onCreateSketch?: (() => void) | undefined;
  /** A section is not a card, so it needs its own action. */
  onCreateSection?: (() => void) | undefined;
  onCreatePortal?: (targetBoardId: string) => void;
  onCreateBoardPortal?: () => void;
  onManageTypes: () => void;
  /** Types, fields and tags; hidden when the session cannot change the schema. */
  canManageSchema?: boolean;
  /** New cards and portals belong to a session that may create content. */
  canCreateContent?: boolean;
  /** "New board and portal" also needs the board capability. */
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
  boards = [],
  activeBoardId = null,
  onToggleLibrary,
  onCreateCard,
  onCreateSketch,
  onCreateSection,
  onCreatePortal,
  onCreateBoardPortal,
  onManageTypes,
  canManageSchema = true,
  canCreateContent = true,
  canCreateBoards = true,
}: DockProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);

  // Two shortcuts reach across the whole app. `Mod+K` opens the command palette
  // (navigation and actions); `Mod+Shift+K` keeps the library search it used to
  // own, so the habit still lands somewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The editor owns Mod-K while it is focused.
      if (event.defaultPrevented) return;
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey) return;
      event.preventDefault();
      const ui = useUiStore.getState();
      if (event.shiftKey) {
        ui.setLibraryOpen(true);
        ui.setLibraryTab("cards");
        window.dispatchEvent(new Event(LIBRARY_SEARCH_FOCUS_EVENT));
        return;
      }
      ui.setPaletteOpen(true);
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
    setPortalOpen(false);
    onCreateCard(typeId);
  };

  const createPortal = (targetBoardId: string) => {
    setMenuOpen(false);
    setPortalOpen(false);
    onCreatePortal?.(targetBoardId);
  };

  const createBoardPortal = () => {
    setMenuOpen(false);
    setPortalOpen(false);
    onCreateBoardPortal?.();
  };

  // A portal always needs a target, so the seed's portal type never appears in
  // the ordinary "new card" list: creating one without a board is meaningless.
  const creatableTypes = types.filter((type) => type.id !== PORTAL_TYPE_ID);
  const portalTargets = boards.filter((board) => board.id !== activeBoardId);
  /** The sketch type's glyph, and a section's dashed frame, drawn as text. */
  const SKETCH_GLYPH = "\u270e";
  const SECTION_GLYPH = "\u25a2";

  const portalAction = canCreateContent && (portalTargets.length > 0 || canCreateBoards);

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
            {creatableTypes.map((type) => (
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

            {onCreateSketch || onCreateSection ? (
              <div className="my-1 h-px bg-[var(--hairline)]" />
            ) : null}
            {/* Sketch and Section mirror the canvas's own context menu, so the
                dock is a complete "new" surface rather than a subset of it. A
                sketch is a type, so it is offered here next to the others; a
                section is not a card, which is why it needs its own row. */}
            {onCreateSketch ? (
              <button
                type="button"
                role="menuitem"
                data-testid="dock-new-sketch"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => {
                  setMenuOpen(false);
                  onCreateSketch();
                }}
              >
                <span aria-hidden="true" className="w-4 text-center text-[var(--ink-muted)]">
                  {SKETCH_GLYPH}
                </span>
                <span className="min-w-0 flex-1 truncate">New sketch</span>
              </button>
            ) : null}
            {onCreateSection ? (
              <button
                type="button"
                role="menuitem"
                data-testid="dock-new-section"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => {
                  setMenuOpen(false);
                  onCreateSection();
                }}
              >
                <span aria-hidden="true" className="w-4 text-center text-[var(--ink-muted)]">
                  {SECTION_GLYPH}
                </span>
                <span className="min-w-0 flex-1 truncate">New section</span>
              </button>
            ) : null}

            {portalAction ? (
              <>
                <div className="my-1 h-px bg-[var(--hairline)]" />
                {/* The portal type is seeded, so it is filtered out of the list
                    above and offered here with a board to open. */}
                <div className="relative">
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={portalOpen}
                    data-testid="dock-new-portal"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => setPortalOpen((open) => !open)}
                  >
                    <span aria-hidden="true" className="w-4 text-center text-[var(--ink-muted)]">
                      {PORTAL_GLYPH}
                    </span>
                    <span className="min-w-0 flex-1 truncate">New portal</span>
                    <span aria-hidden="true" className="text-xs opacity-60">
                      {"\u25b8"}
                    </span>
                  </button>
                  {portalOpen ? (
                    <div
                      role="menu"
                      aria-label="New portal"
                      data-testid="dock-portal-menu"
                      className="absolute bottom-0 left-full ml-1 min-w-[170px] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
                    >
                      {portalTargets.map((board) => (
                        <button
                          key={board.id}
                          type="button"
                          role="menuitem"
                          data-testid={`dock-portal-${board.id}`}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/10"
                          onClick={() => createPortal(board.id)}
                        >
                          <span className="min-w-0 flex-1 truncate">{board.name}</span>
                        </button>
                      ))}
                      {canCreateBoards ? (
                        <button
                          type="button"
                          role="menuitem"
                          data-testid="dock-portal-new-board"
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                          onClick={createBoardPortal}
                        >
                          <span className="min-w-0 flex-1 truncate">New board</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
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
