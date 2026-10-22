import type { Card, CardType, FieldDefinition } from "@suite/graph";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useSyncExternalStore } from "react";
import { propertyBlockDisplayValue } from "../editor/PropertyBlockChip";
import { useCardTitle } from "../hooks/useCardContainers";
import { useUiStore } from "../store/useUiStore";
import { useCard, useWorkspaceStore } from "../store/workspaceStore";

/** The field behind a `@card.field` chip, in the target card's type order. */
function fieldFor(card: Card, fieldId: string, types: readonly CardType[]) {
  for (const typeId of card.typeIds) {
    const field: FieldDefinition | undefined = types
      .find((type) => type.id === typeId)
      ?.fields.find((candidate) => candidate.id === fieldId);
    if (field) return field;
  }
  return undefined;
}

/** Field definitions change when a type is edited; other changes keep identity. */
function useTypes(): CardType[] {
  const store = useWorkspaceStore();
  const get = () => store.getSnapshot().types;
  return useSyncExternalStore(store.subscribe, get, get);
}

export interface MentionChipProps {
  cardId: string;
  /** Live display title, including the body-first-line fallback. */
  title: string;
  /** The target is missing or trashed; the chip stops being a link. */
  unavailable?: boolean;
  /**
   * `@card.field`: the field's live label and value, read-only. The chip is a
   * link to the panel rather than an editor, so one click edits where the
   * value is safe to edit.
   */
  field?: { id: string; name: string; display: string } | undefined;
  onOpen?: (cardId: string, fieldId?: string | undefined) => void;
}

/**
 * The mention itself. Kept presentational so stories and tests can render both
 * states without a workspace; `MentionChipNodeView` supplies the live data.
 */
export function MentionChip({
  cardId,
  title,
  unavailable = false,
  field,
  onOpen,
}: MentionChipProps) {
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
      data-field-id={field?.id}
      contentEditable={false}
      title={field ? `${title} \u00b7 ${field.name}` : title}
      tabIndex={-1}
      className={field ? "mention-chip mention-chip-field" : "mention-chip"}
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
        onOpen?.(cardId, field?.id);
      }}
    >
      <span aria-hidden="true" className="mention-chip-at">
        @
      </span>
      <span className="mention-chip-title">{title}</span>
      {field ? (
        <>
          <span className="mention-chip-field-name">{field.name}</span>
          <span className="mention-chip-field-value" data-testid="mention-chip-value">
            {field.display}
          </span>
        </>
      ) : null}
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
  const fieldId = typeof node.attrs.fieldId === "string" ? node.attrs.fieldId : "";
  const card = useCard(cardId);
  const title = useCardTitle(cardId);
  const types = useTypes();
  const openInspector = useUiStore((state) => state.openInspector);

  const definition = card && fieldId ? fieldFor(card, fieldId, types) : undefined;
  const value = fieldId ? card?.properties[fieldId] : undefined;
  const cardLabel = useCardTitle(
    definition?.kind === "card" && typeof value === "string" ? value : "",
  );

  const field =
    definition && card
      ? {
          id: definition.id,
          name: definition.name,
          // The same formatter the body block uses, so both read identically.
          display: propertyBlockDisplayValue(definition, value, cardLabel),
        }
      : undefined;

  return (
    <NodeViewWrapper as="span" className="mention-node" contentEditable={false}>
      <MentionChip
        cardId={cardId}
        title={title}
        unavailable={!card || Boolean(card.deletedAt)}
        field={field}
        onOpen={(id, openFieldId) => openInspector(id, openFieldId ?? null)}
      />
    </NodeViewWrapper>
  );
}
