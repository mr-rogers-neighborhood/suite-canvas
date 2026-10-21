import { type Section, sectionMembership } from "@suite/graph";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo } from "react";
import type { PeerPresence } from "../collab/presence";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import "../styles/outline.css";
import { outlinePeerIds, outlineRows } from "./outlineTree";

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
        </nav>
      ) : (
        <button
          type="button"
          className="board-outline__tab"
          data-testid="outline-tab"
          aria-label={`Expand outline (${rows.length} section${rows.length === 1 ? "" : "s"})`}
          onClick={onToggle}
        >
          <span className="board-outline__tab-count">{rows.length}</span>
          <span aria-hidden="true" className="board-outline__tab-label">
            Outline
          </span>
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
  const focusSection = useUiStore((state) => state.focusSection);
  const openContextMenu = useUiStore((state) => state.openContextMenu);
  const peers = useBoardPeers(activeBoardId);

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

  // A board with no sections gets no rail at all, not an empty one.
  if (!activeBoardId || sections.length === 0) return null;

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
    />
  );
}
