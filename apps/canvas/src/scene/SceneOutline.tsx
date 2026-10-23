import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useMemo, useRef } from "react";
import "../styles/scene-outline.css";

export type SceneOutlineKind = "board" | "portal" | "cycle";
export type SceneOutlineLod = "full" | "compact" | "icon" | "hidden";

export interface SceneOutlinePeer {
  name: string;
  color: string;
}

/**
 * A row is already flattened by the scene projection: `depth` is the only
 * ordering information the rail needs, and `hasChildren`/`expanded` decide
 * whether the disclosure is actionable.
 */
export interface SceneOutlineItem {
  id: string;
  label: string;
  kind: SceneOutlineKind;
  depth: number;
  lod: SceneOutlineLod;
  expanded: boolean;
  hasChildren: boolean;
  boardId?: string;
  portalCardId?: string;
  cardCount?: number;
  peers?: readonly SceneOutlinePeer[];
  cycle?: boolean;
  unavailable?: boolean;
}

export interface SceneOutlineProps {
  items: readonly SceneOutlineItem[];
  activeId: string | null;
  open: boolean;
  onToggleOpen: () => void;
  onSelect: (item: SceneOutlineItem) => void;
  onToggleExpand: (item: SceneOutlineItem) => void;
  onBack?: () => void;
}

const KIND_GLYPH: Record<SceneOutlineKind, string> = {
  board: "\u25a6",
  portal: "\u25c9",
  cycle: "\u21ba",
};

const LOD_LABEL: Record<SceneOutlineLod, string> = {
  full: "Full detail",
  compact: "Compact",
  icon: "Icon",
  hidden: "Hidden",
};

/**
 * The non-spatial view of the same scene tree: root board, portal instances,
 * target boards and nested portals. It is deliberately independent of the
 * canvas engine so it can drive navigation, search and reader mode.
 */
export function SceneOutline({
  items,
  activeId,
  open,
  onToggleOpen,
  onSelect,
  onToggleExpand,
  onBack,
}: SceneOutlineProps) {
  const labelRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusAt = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      labelRefs.current.get(item.id)?.focus();
    },
    [items],
  );

  const parentIndex = useCallback(
    (index: number): number => {
      const depth = items[index]?.depth ?? 0;
      if (depth <= 0) return -1;
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if ((items[cursor]?.depth ?? 0) < depth) return cursor;
      }
      return -1;
    },
    [items],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      const item = items[index];
      if (!item) return;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusAt(Math.min(items.length - 1, index + 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          focusAt(Math.max(0, index - 1));
          break;
        case "ArrowRight":
          event.preventDefault();
          if (item.hasChildren && !item.expanded) {
            onToggleExpand(item);
            return;
          }
          if (item.hasChildren && item.expanded) {
            focusAt(index + 1);
            return;
          }
          onSelect(item);
          break;
        case "ArrowLeft": {
          event.preventDefault();
          if (item.hasChildren && item.expanded) {
            onToggleExpand(item);
            return;
          }
          const parent = parentIndex(index);
          if (parent >= 0) focusAt(parent);
          break;
        }
        case "Home":
          event.preventDefault();
          focusAt(0);
          break;
        case "End":
          event.preventDefault();
          focusAt(items.length - 1);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          onSelect(item);
          break;
        case "Escape":
          if (onBack) {
            event.preventDefault();
            onBack();
          }
          break;
        default:
          break;
      }
    },
    [focusAt, items, onBack, onSelect, onToggleExpand, parentIndex],
  );

  const boardCount = useMemo(() => items.filter((item) => item.kind === "board").length, [items]);

  if (!open) {
    return (
      <div className="scene-outline">
        <button
          type="button"
          className="scene-outline__tab"
          data-testid="scene-outline-tab"
          title={`Scene outline, ${boardCount} board${boardCount === 1 ? "" : "s"}`}
          aria-expanded={false}
          onClick={onToggleOpen}
        >
          <span className="scene-outline__tab-label">Scene</span>{" "}
          <span className="scene-outline__tab-count">{boardCount}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="scene-outline" data-testid="scene-outline">
      <nav className="scene-outline__panel" aria-label="Scene outline">
        <header className="scene-outline__header">
          <span className="scene-outline__heading">Scene</span>
          <span className="scene-outline__total" data-testid="scene-outline-count">
            {boardCount}
          </span>
          {onBack ? (
            <button
              type="button"
              className="scene-outline__back"
              data-testid="scene-outline-back"
              aria-label="Back to the previous view"
              title="Back to the previous view"
              onClick={onBack}
            >
              {"\u2039"}
            </button>
          ) : null}
          <button
            type="button"
            className="scene-outline__toggle"
            data-testid="scene-outline-toggle"
            aria-label="Collapse scene outline"
            aria-expanded
            onClick={onToggleOpen}
          >
            {"\u2039"}
          </button>
        </header>

        <div className="scene-outline__rows" role="tree" aria-label="Scene tree">
          {items.map((item, index) => {
            const active = item.id === activeId;
            const label = item.label.trim() || "Untitled board";
            const glyph = item.cycle ? KIND_GLYPH.cycle : KIND_GLYPH[item.kind];
            return (
              <div
                key={item.id}
                role="treeitem"
                tabIndex={-1}
                aria-level={item.depth + 1}
                aria-expanded={item.hasChildren ? item.expanded : undefined}
                aria-selected={active}
                data-testid="scene-outline-row"
                data-kind={item.kind}
                data-lod={item.lod}
                data-depth={item.depth}
              >
                <div
                  className={`scene-outline__row${active ? " is-active" : ""}`}
                  style={{ paddingLeft: 4 + item.depth * 12 }}
                >
                  {item.hasChildren ? (
                    <button
                      type="button"
                      className="scene-outline__disclosure"
                      data-testid="scene-outline-expand"
                      aria-label={item.expanded ? `Collapse ${label}` : `Expand ${label}`}
                      title={item.expanded ? "Collapse" : "Expand"}
                      onClick={() => onToggleExpand(item)}
                    >
                      <span aria-hidden="true">{item.expanded ? "\u25be" : "\u25b8"}</span>
                    </button>
                  ) : (
                    <span className="scene-outline__disclosure is-empty" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    ref={(element) => {
                      if (element) labelRefs.current.set(item.id, element);
                      else labelRefs.current.delete(item.id);
                    }}
                    className="scene-outline__label"
                    data-testid="scene-outline-label"
                    aria-current={active ? "true" : undefined}
                    title={label}
                    onClick={() => onSelect(item)}
                    onKeyDown={(event) => handleKeyDown(event, index)}
                  >
                    <span className="scene-outline__glyph" aria-hidden="true">
                      {glyph}
                    </span>
                    <span className="scene-outline__title">{label}</span>{" "}
                    {item.unavailable ? (
                      <span className="scene-outline__unavailable" aria-hidden="true">
                        {"\u2298"}
                      </span>
                    ) : null}
                    <span
                      className="scene-outline__lod"
                      data-testid="scene-outline-lod"
                      title={LOD_LABEL[item.lod]}
                      aria-hidden="true"
                    >
                      {item.lod === "full"
                        ? "F"
                        : item.lod === "compact"
                          ? "C"
                          : item.lod === "icon"
                            ? "I"
                            : "H"}
                    </span>{" "}
                    {item.cardCount !== undefined ? (
                      <span
                        className="scene-outline__count"
                        data-testid="scene-outline-card-count"
                        aria-hidden="true"
                      >
                        {item.cardCount}
                      </span>
                    ) : null}
                    <span className="sr-only">
                      {LOD_LABEL[item.lod]}
                      {item.cardCount !== undefined ? `, ${item.cardCount} cards` : ""}
                      {item.unavailable ? ", unavailable" : ""}
                    </span>
                    {item.peers?.map((peer) => (
                      <span
                        key={`${peer.name}:${peer.color}`}
                        className="scene-outline__peer"
                        data-testid="scene-outline-peer"
                        title={peer.name}
                        aria-hidden="true"
                        style={{ backgroundColor: peer.color }}
                      />
                    ))}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
