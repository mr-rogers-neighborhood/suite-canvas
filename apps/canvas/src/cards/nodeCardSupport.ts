import type { StyleShape } from "@suite/graph";
import type { CSSProperties } from "react";
import type { PresenceUser } from "../collab/presence";
import type { ContextMenuItem } from "../dialogs/ContextMenu";

export type EditingField = "title" | "body";

export function buildPresenceStyle(
  draggingPeer?: PresenceUser,
  focusedBy?: PresenceUser,
  resizingPeer?: PresenceUser,
  selectingPeer?: PresenceUser,
): CSSProperties {
  if (draggingPeer) {
    return { borderColor: draggingPeer.color, boxShadow: `0 0 0 3px ${draggingPeer.color}55` };
  }
  if (focusedBy) {
    return { borderColor: focusedBy.color, boxShadow: `0 0 0 2px ${focusedBy.color}33` };
  }
  if (resizingPeer) {
    return { borderColor: resizingPeer.color, boxShadow: `0 0 0 2px ${resizingPeer.color}44` };
  }
  if (selectingPeer) {
    return { boxShadow: `0 0 0 2px ${selectingPeer.color}66` };
  }
  return {};
}

export function buildNodeCardClass({
  painted,
  selected,
  draggingPeer,
  focusedBy,
  shape,
  dim,
  onLens,
}: {
  painted: boolean;
  selected: boolean;
  draggingPeer?: PresenceUser | undefined;
  focusedBy?: PresenceUser | undefined;
  shape: StyleShape | null;
  dim: boolean;
  onLens: boolean;
}): string {
  return [
    "node-card relative flex flex-col rounded-md border border-[var(--hairline)]",
    painted ? "is-painted" : "",
    selected && !draggingPeer && !focusedBy
      ? shape
        ? "is-selected border-transparent"
        : "border-blue-500 ring-2 ring-blue-200 dark:ring-blue-500/30"
      : "",
    dim && !selected ? "is-off-lens" : "",
    onLens && !selected ? "is-on-lens" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export interface BuildMenuItemsParams {
  onOpenInfo?: (() => void) | undefined;
  isBook: boolean;
  isCanvasReader: boolean;
  toggleCanvasReader: (cardId: string) => void;
  cardId: string;
  onSetType?: ((typeId: string) => void) | undefined;
  typeTargets: { id: string; name: string }[];
  hasMeta: boolean;
  metaExpanded: boolean;
  onToggleMeta?: (() => void) | undefined;
  onDuplicate?: (() => void) | undefined;
  onMoveToBoard?: ((boardId: string) => void) | undefined;
  moveTargets: { id: string; name: string }[];
  onFocusCard?: (() => void) | undefined;
  editContent: boolean;
  editLayout: boolean;
  canTrash: boolean;
  onStartEditing?: ((field: EditingField) => void) | undefined;
  onRemoveFromBoard?: (() => void) | undefined;
  onTrash?: (() => void) | undefined;
}

export function buildNodeCardMenuItems({
  onOpenInfo,
  isBook,
  isCanvasReader,
  toggleCanvasReader,
  cardId,
  onSetType,
  typeTargets,
  hasMeta,
  metaExpanded,
  onToggleMeta,
  onDuplicate,
  onMoveToBoard,
  moveTargets,
  onFocusCard,
  editContent,
  editLayout,
  canTrash,
  onStartEditing,
  onRemoveFromBoard,
  onTrash,
}: BuildMenuItemsParams): ContextMenuItem[] {
  const items: ContextMenuItem[] = [{ label: "Card info", onSelect: () => onOpenInfo?.() }];
  if (isBook) {
    items.push({
      label: isCanvasReader ? "Show book cover" : "Read on canvas",
      onSelect: () => toggleCanvasReader(cardId),
    });
  }
  if (onSetType && typeTargets.length > 1) {
    items.push({
      label: "Change type",
      items: typeTargets.map((entry) => ({
        label: entry.name,
        onSelect: () => onSetType(entry.id),
      })),
    });
  }
  if (hasMeta && onToggleMeta) {
    items.push({
      label: `${metaExpanded ? "Hide" : "Show"} details`,
      onSelect: onToggleMeta,
    });
  }
  if (onDuplicate) {
    items.push({ label: "Duplicate", onSelect: () => onDuplicate() });
  }
  if (onMoveToBoard && moveTargets.length > 0) {
    items.push({
      label: "Move to board",
      items: moveTargets.map((board) => ({
        label: board.name,
        onSelect: () => onMoveToBoard(board.id),
      })),
    });
  }
  if (onFocusCard) {
    items.push({ label: "Open in focus", onSelect: () => onFocusCard() });
  }
  if (editContent) {
    items.push(
      { label: "Edit title", onSelect: () => onStartEditing?.("title") },
      { label: "Edit body", onSelect: () => onStartEditing?.("body") },
    );
  }
  if (editLayout) {
    items.push({ label: "Remove from board", onSelect: () => onRemoveFromBoard?.() });
  }
  if (canTrash) {
    items.push({ label: "Delete card", danger: true, onSelect: () => onTrash?.() });
  }
  return items;
}
