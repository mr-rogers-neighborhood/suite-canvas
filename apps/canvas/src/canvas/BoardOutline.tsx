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

export interface OutlineTreeProps {
  sections: Section[];
  /** Card id to the section that contains it, on this board. */
  membership: Map<string, string>;
  peers: PeerPresence[];
  selectedSectionId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelect: (sectionId: string) => void;
  onContextMenu: (event: ReactMouseEvent, sectionId: string) => void;
  /** Whether this session may make a section, which the empty rail offers. */
  canCreate?: boolean;
  /** The peek a row opens on rest or on keyboard focus (ADR-0055). */
  peek?: PeekController | undefined;
}

/** The rail itself: plain props so Storybook can render it without the store. */
export function OutlineTree({
  sections,
  membership,
  peers,
  selectedSectionId,
  open,
  onToggle,
  onSelect,
  onContextMenu,
  canCreate = false,
  peek,
}: OutlineTreeProps) {
  const rows = useMemo(() => outlineRows(sections, membership), [sections, membership]);
  const peersBySection = useMemo(() => outlinePeerIds(peers), [peers]);

  return (
    <div className="board-outline" data-testid="outline-rail">
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
            {/* A board with no sections still gets the rail: an outline that
                vanishes is indistinguishable from one that has nothing to say. */}
            {rows.length === 0 ? (
              <div className="board-outline__empty" data-testid="outline-empty">
                <p>No sections on this board.</p>
                <p>{canCreate ? "Cmd/Ctrl+G makes one." : "Sections appear here."}</p>
              </div>
            ) : null}
            {rows.map((row) => {
              const { section, depth, count } = row;
              const active = selectedSectionId === section.id;
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
                  onClick={() => onSelect(section.id)}
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
                      backgroundColor: section.color
                        ? `var(--section-${section.color})`
                        : "var(--section-slate)",
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
  const selectedSectionId = useUiStore((state) => state.selectedSectionId);
  const selectSection = useUiStore((state) => state.selectSection);
  const canCreateContent = useUiStore((state) => state.canCreateContent);
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
      if (event.defaultPrevented || event.key !== "[") return;
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
    (sectionId: string) => {
      if (!activeBoardId) return;
      selectSection(sectionId);
      focusSection(sectionId, activeBoardId);
    },
    [activeBoardId, selectSection, focusSection],
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

  // An empty board keeps the rail so the outline has a place to say it is
  // empty, and so the toggle exists before the first section does.
  if (!activeBoardId) return null;

  return (
    <OutlineTree
      sections={sections}
      membership={membership}
      peers={peers}
      selectedSectionId={selectedSectionId}
      open={outlineOpen}
      onToggle={toggleOutline}
      onSelect={handleSelect}
      onContextMenu={handleContextMenu}
      canCreate={canCreateContent}
      peek={peek}
    />
  );
}
