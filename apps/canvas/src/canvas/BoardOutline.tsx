import { type Section, sectionMembership } from "@suite/graph";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo } from "react";
import type { PeerPresence } from "../collab/presence";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import "../styles/outline.css";
import "./boardAffordances.css";
import { outlinePeerIds, outlineRows } from "./outlineTree";
import { PeekSurface } from "./peek/PeekSurface";
import { anchorOf } from "./peek/peekAnchor";
import { useEntityPeek } from "./peek/useEntityPeek";
import type { PeekController } from "./peek/usePeek";
import { sectionSwatch } from "./sections/sectionPalette";
import { useSurfacePaint } from "./surfaceContext";

export interface OutlineTreeProps {
  sections: Section[];
  /** Card id to the section that contains it, on this board. */
  membership: Map<string, string>;
  peers: PeerPresence[];
  /** Every frame in the selection: a row shows as active when it is one of them. */
  selectedSectionIds: ReadonlySet<string>;
  open: boolean;
  onToggle: () => void;
  /** `additive` is the modifier press: membership, without travelling to the section. */
  onSelect: (sectionId: string, additive?: boolean) => void;
  onContextMenu: (event: ReactMouseEvent, sectionId: string) => void;
  /** Whether this session may make a section, which the empty rail offers. */
  /** The peek a row opens on rest or on keyboard focus (ADR-0055). */
  peek?: PeekController | undefined;
}

/** The rail itself: plain props so Storybook can render it without the store. */
export function OutlineTree({
  sections,
  membership,
  peers,
  selectedSectionIds,
  open,
  onToggle,
  onSelect,
  onContextMenu,
  peek,
}: OutlineTreeProps) {
  const rows = useMemo(() => outlineRows(sections, membership), [sections, membership]);
  const peersBySection = useMemo(() => outlinePeerIds(peers), [peers]);
  // The default context carries the shipped palette, so a story or a test renders the same dot
  // a workspace with an edited palette does.
  const surface = useSurfacePaint();

  return (
    <div className="board-outline" data-testid="outline-rail" data-handbook-region="board-outline">
      {open ? (
        <nav
          className="board-outline__panel"
          data-testid="outline-panel"
          aria-label="Board outline"
        >
          <header className="board-outline__header">
            <span className="board-outline__heading">Outline</span>
            <span className="board-outline__total" data-testid="outline-count">
              {rows.length}
            </span>
            <button
              type="button"
              className="board-outline__toggle"
              data-testid="outline-toggle"
              aria-label="Collapse outline"
              aria-expanded
              onClick={onToggle}
            >
              {"\u2039"}
            </button>
          </header>
          <div className="board-outline__rows">
            {rows.map((row) => {
              const { section, depth, count } = row;
              const active = selectedSectionIds.has(section.id);
              const title = section.title.trim() || "Untitled section";
              const rowPeers = peersBySection.get(section.id) ?? [];
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`board-outline__row${active ? " is-active" : ""}`}
                  data-testid="outline-row"
                  data-section-id={section.id}
                  data-depth={depth}
                  aria-current={active ? "true" : undefined}
                  title={title}
                  style={{ paddingLeft: 8 + depth * 12 }}
                  onClick={(event) =>
                    onSelect(section.id, event.metaKey || event.ctrlKey || event.shiftKey)
                  }
                  onContextMenu={(event) => onContextMenu(event, section.id)}
                  // A rest names the section; a click still selects it, because a
                  // focus that followed a press is suppressed in `usePeek`.
                  onPointerEnter={(event) =>
                    peek?.hover({ kind: "section", id: section.id }, anchorOf(event.currentTarget))
                  }
                  onPointerLeave={() => peek?.leave()}
                  onFocus={(event) =>
                    peek?.focus({ kind: "section", id: section.id }, anchorOf(event.currentTarget))
                  }
                  onBlur={() => peek?.leave()}
                >
                  <span
                    aria-hidden="true"
                    className="board-outline__dot"
                    style={{
                      backgroundColor: sectionSwatch(section.color, surface.palette, surface.mode)
                        .stroke,
                    }}
                  />
                  <span className="board-outline__title">{title}</span>
                  <span className="board-outline__row-count" data-testid="outline-row-count">
                    {count}
                  </span>
                  {rowPeers.map((rowPeer) => (
                    <span
                      key={rowPeer.clientId}
                      className="board-outline__peer"
                      data-testid="outline-peer-dot"
                      data-peer-name={rowPeer.user.name}
                      title={rowPeer.user.name}
                      style={{ backgroundColor: rowPeer.user.color }}
                    />
                  ))}
                </button>
              );
            })}
          </div>
          {/* One peek for the whole rail: a row's rest opens it, and moving into it
              keeps it while the pointer is there. */}
          <PeekSurface
            peek={peek?.peek ?? null}
            onEnter={peek?.stay}
            onLeave={peek?.leave}
            onOpen={(target) => {
              if (target.kind !== "section") return;
              onSelect(target.id);
              peek?.dismiss();
            }}
          />
        </nav>
      ) : (
        <button
          type="button"
          className="board-outline__tab"
          data-testid="outline-tab"
          aria-label={`Outline, ${rows.length} section${rows.length === 1 ? "" : "s"}`}
          aria-expanded={false}
          // The label leads in the DOM so the name starts with the visible text;
          // column-reverse keeps the count on top, as designed.
          style={{ flexDirection: "column-reverse" }}
          onClick={onToggle}
        >
          <span className="board-outline__tab-label">Outline</span>{" "}
          <span className="board-outline__tab-count">{rows.length}</span>
        </button>
      )}
    </div>
  );
}

/**
 * Binds the rail to the active board. Section membership is derived here, so
 * the rail cannot disagree with the canvas about who is inside what.
 */
export function BoardOutlineHost() {
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const outlineOpen = useUiStore((state) => state.outlineOpen);
  const toggleOutline = useUiStore((state) => state.toggleOutline);
  const selectedSectionIds = useUiStore((state) => state.selectedSectionIds);
  const selectSection = useUiStore((state) => state.selectSection);
  const toggleSection = useUiStore((state) => state.toggleSection);
  const focusSection = useUiStore((state) => state.focusSection);
  const openContextMenu = useUiStore((state) => state.openContextMenu);
  const peers = useBoardPeers(activeBoardId);
  const peek = useEntityPeek();

  const sections = useMemo(
    () =>
      activeBoardId ? snapshot.sections.filter((section) => section.boardId === activeBoardId) : [],
    [snapshot.sections, activeBoardId],
  );

  const membership = useMemo(() => {
    if (!activeBoardId) return new Map<string, string>();
    return sectionMembership(
      snapshot.placements.filter((placement) => placement.boardId === activeBoardId),
      sections,
    );
  }, [snapshot.placements, sections, activeBoardId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // `\` rather than `[`: both brackets flip the stack in the reader's hand, and a key that means two things
      // depends on which listener ran first. The outline's own key has to be one nothing else wants.
      if (event.defaultPrevented || event.key !== "\\") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }
      event.preventDefault();
      toggleOutline();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleOutline]);

  const handleSelect = useCallback(
    (sectionId: string, additive = false) => {
      if (!activeBoardId) return;
      // A modifier builds a set and stays put: travelling to a frame while adding it would move the
      // camera away from the one the reader was looking at.
      if (additive) {
        toggleSection(sectionId);
        return;
      }
      selectSection(sectionId);
      focusSection(sectionId, activeBoardId);
    },
    [activeBoardId, selectSection, toggleSection, focusSection],
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent, sectionId: string) => {
      // Reuse the canvas menu: the outline must not drift from the section's
      // own rename / colour / select / delete commands.
      event.preventDefault();
      openContextMenu({ x: event.clientX, y: event.clientY, kind: "section", sectionId });
    },
    [openContextMenu],
  );

  // Nothing to outline is nothing to show. The rail used to stay up on an empty
  // board to say it was empty, which put a panel in the corner of every new
  // board; the toggle beside the tabs and `[` are still there when a section
  // arrives.
  if (!activeBoardId || sections.length === 0) return null;

  return (
    <OutlineTree
      sections={sections}
      membership={membership}
      peers={peers}
      selectedSectionIds={new Set(selectedSectionIds)}
      open={outlineOpen}
      onToggle={toggleOutline}
      onSelect={handleSelect}
      onContextMenu={handleContextMenu}
      peek={peek}
    />
  );
}
