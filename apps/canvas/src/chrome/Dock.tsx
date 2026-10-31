import type { Board, CardType } from "@suite/graph";
import { useEffect, useRef, useState } from "react";
import { ShortcutSheetHost } from "../command/ShortcutSheet";
import { openShortcutSheet } from "../command/shortcutSheet";
import { LIBRARY_SEARCH_FOCUS_EVENT } from "../hooks/useLibrarySearch";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useUiStore } from "../store/useUiStore";
import { NewThingMenu } from "./NewThingMenu";
import { newThingMenuModel } from "./newThingMenu";

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
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  useEscapeLayer(() => setMenuOpen(false), menuOpen);

  const create = (typeId: string) => {
    setMenuOpen(false);
    setPortalOpen(false);
    onCreateCard(typeId);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setPortalOpen(false);
  };

  const model = newThingMenuModel({
    types,
    boards,
    activeBoardId,
    libraryOpen,
    canCreateContent: canCreateContent === true,
    canCreateBoards: canCreateBoards === true,
    handlers: {
      ...(onCreateSketch === undefined ? {} : { createSketch: onCreateSketch }),
      ...(onCreateSection === undefined ? {} : { createSection: onCreateSection }),
      ...(onCreatePortal === undefined ? {} : { createPortal: onCreatePortal }),
      ...(onCreateBoardPortal === undefined ? {} : { createBoardPortal: onCreateBoardPortal }),
    },
  });

  return (
    <div className="dock" role="toolbar" aria-label="Card library" data-handbook-region="dock">
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
          <NewThingMenu
            model={model}
            direction="up"
            prefix="dock"
            onCreateCard={create}
            portalOpen={portalOpen}
            onTogglePortal={() => setPortalOpen((open) => !open)}
            onDone={closeMenu}
            trailing={
              canManageSchema ? (
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
              ) : null
            }
          />
        ) : null}
      </div>

      <span className="dock-separator" aria-hidden="true" />

      <button
        type="button"
        aria-haspopup="dialog"
        data-testid="dock-shortcuts"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        className="dock-button"
        onClick={openShortcutSheet}
      >
        <span aria-hidden="true" className="text-[13px] leading-none">
          ?
        </span>
      </button>
      <ShortcutSheetHost />
    </div>
  );
}
