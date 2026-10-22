import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useCardTitle } from "../hooks/useCardContainers";
import { useUiStore } from "../store/useUiStore";
import { useCard } from "../store/workspaceStore";

export interface MentionChipProps {
  cardId: string;
  /** Live display title, including the body-first-line fallback. */
  title: string;
  /** The target is missing or trashed; the chip stops being a link. */
  unavailable?: boolean;
  onOpen?: (cardId: string) => void;
}

/**
 * The mention itself. Kept presentational so stories and tests can render both
 * states without a workspace; `MentionChipNodeView` supplies the live data.
 */
export function MentionChip({ cardId, title, unavailable = false, onOpen }: MentionChipProps) {
  if (unavailable) {
    return (
      <span
        data-testid="mention-chip"
        data-card-id={cardId}
        data-unavailable="true"
        contentEditable={false}
        className="mention-chip mention-chip-unavailable"
      >
        Unavailable card
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid="mention-chip"
      data-card-id={cardId}
      contentEditable={false}
      title={title}
      tabIndex={-1}
      className="mention-chip"
      // The editor owns the pointer and the selection: clicking a chip must not
      // start a card drag or move the caret before the panel opens.
      onPointerDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.(cardId);
      }}
    >
      <span aria-hidden="true" className="mention-chip-at">
        @
      </span>
      <span className="mention-chip-title">{title}</span>
    </button>
  );
}

/**
 * Tiptap node view. Reading the title through the document subscription is what
 * makes a mention follow a peer's rename, and using the snapshot for existence
 * is what turns a trashed target into *Unavailable card*.
 */
export function MentionChipNodeView({ node }: NodeViewProps) {
  const cardId = typeof node.attrs.cardId === "string" ? node.attrs.cardId : "";
  const card = useCard(cardId);
  const title = useCardTitle(cardId);
  const openInspector = useUiStore((state) => state.openInspector);

  return (
    <NodeViewWrapper as="span" className="mention-node" contentEditable={false}>
      <MentionChip
        cardId={cardId}
        title={title}
        unavailable={!card || Boolean(card.deletedAt)}
        onOpen={openInspector}
      />
    </NodeViewWrapper>
  );
}
