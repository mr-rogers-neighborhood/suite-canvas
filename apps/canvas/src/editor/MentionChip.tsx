import type { Card, CardPresence, CardType, FieldDefinition } from "@suite/graph";
import {
  displayTemplate,
  MENTION_DISPLAY_TEMPLATE,
  referencedCardLabel,
  type TemplateContext,
} from "@suite/graph";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useState, useSyncExternalStore } from "react";
import { ValueTemplate } from "../cards/ValueTemplate";
import { ContextMenu } from "../dialogs/ContextMenu";
import { DisplayStyleDialog } from "../dialogs/DisplayStyleDialog";
import { useCardPresence, useCardTitle } from "../hooks/useCardContainers";
import { useAnnotations } from "../reader/useHighlights";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useCard, useWorkspaceStore } from "../store/workspaceStore";
import { propertyBlockDisplayValue } from "./PropertyBlockChip";

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

export interface MentionChipField {
  id: string;
  /** The field's name, for `{{label}}`. */
  name: string;
  /** The value as text, before any template. */
  value: string;
  /** The template in effect: the field's, or this mention's override. */
  template: string;
  /** The field's own template, so the dialog can show what a reset restores. */
  fieldTemplate: string;
  /** The card's type name, for `{{type}}`. */
  typeName: string;
  /** True when this chip carries its own template. */
  overridden: boolean;
}

export interface MentionChipProps {
  cardId: string;
  /** Live display title, including the body-first-line fallback. */
  title: string;
  /**
   * How this workspace knows the target: a live card, a projection stub (the
   * reference is real but the card is not shared), or nothing at all.
   */
  presence?: CardPresence;
  /** Legacy alias for a missing target; trashed cards arrive this way. */
  unavailable?: boolean;
  /**
   * `@card.field`: the field's live label and value, rendered through the
   * display template. The chip is a link to the panel rather than an editor, so
   * one click edits where the value is safe to edit.
   */
  field?: MentionChipField | undefined;
  onOpen?: (cardId: string, fieldId?: string | undefined) => void;
  /** Applies a template to this mention only; `null` clears the override. */
  onSetDisplay?: ((template: string | null) => void) | undefined;
  /** Applies a template to the field, for every use. */
  onSetFieldDisplay?: ((template: string | null) => void) | undefined;
  /** Viewers can open the card but not restyle the chip. */
  allowDisplay?: boolean;
  /** Only a session with schema capability may restyle every use of the field. */
  allowFieldScope?: boolean;
}

/**
 * Inert styling for an unshared reference. Inline so it applies without a
 * stylesheet rule, and so the base chip's hover accent cannot make an
 * unopenable chip look clickable.
 */
const NOT_SHARED_CHIP = {
  background: "var(--segmented-bg)",
  color: "var(--ink-muted)",
  cursor: "default",
  fontWeight: 400,
} as const;

/* No opacity: fading muted ink over a chip drops it below 4.5:1. */
const NOT_SHARED_NOTE = { marginLeft: 3 } as const;

/** The chip's own menu: this is a mention, so actions stay in place. */
function chipMenuItems(
  field: MentionChipField | undefined,
  onOpen: MentionChipProps["onOpen"],
  cardId: string,
  openDisplay: () => void,
  allowDisplay: boolean,
) {
  return [
    { label: "Open card", onSelect: () => onOpen?.(cardId, field?.id) },
    ...(field && allowDisplay ? [{ label: "Display\u2026", onSelect: openDisplay }] : []),
  ];
}

/**
 * The mention itself. Kept presentational so stories and tests can render both
 * states without a workspace; `MentionChipNodeView` supplies the live data.
 */
export function MentionChip({
  cardId,
  title,
  presence,
  unavailable = false,
  field,
  onOpen,
  onSetDisplay,
  onSetFieldDisplay,
  allowDisplay = true,
  allowFieldScope = true,
}: MentionChipProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editingDisplay, setEditingDisplay] = useState(false);
  const state: CardPresence = unavailable ? "missing" : (presence ?? "card");

  if (state === "stub") {
    // The share knows this card exists but did not copy it: keep the reader's
    // sense of the reference without pretending it can be opened. Muted, not
    // an error: the card is not gone, it is simply not part of this share.
    const label = referencedCardLabel(title);
    return (
      <span
        data-testid="mention-chip"
        data-card-id={cardId}
        data-not-shared="true"
        role="note"
        contentEditable={false}
        className="mention-chip mention-chip-not-shared"
        style={NOT_SHARED_CHIP}
        title={`${label} \u2014 not shared`}
        aria-label={`${label} \u2014 not shared`}
      >
        <span aria-hidden="true" className="mention-chip-at">
          @
        </span>
        <span className="mention-chip-title">{label}</span>
        <span className="mention-chip-note" style={NOT_SHARED_NOTE}>
          {"\u00b7 not shared"}
        </span>
      </span>
    );
  }

  if (state === "missing") {
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

  const context: TemplateContext | null = field
    ? { label: field.name, value: field.value, card: title, type: field.typeName }
    : null;

  const openMenu = (x: number, y: number) => setMenu({ x, y });

  return (
    <>
      <button
        type="button"
        data-testid="mention-chip"
        data-card-id={cardId}
        data-field-id={field?.id}
        data-overridden={field?.overridden ? "true" : undefined}
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
        // A field chip has more than one thing to offer (open it, restyle it),
        // so a plain click opens the menu; a plain mention has only one, and
        // going straight to the card is faster than a menu with one row.
        onContextMenu={(event) => {
          if (!field) return;
          event.preventDefault();
          event.stopPropagation();
          openMenu(event.clientX, event.clientY);
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (!field) {
            onOpen?.(cardId, undefined);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          openMenu(rect.left, rect.bottom + 2);
        }}
      >
        {field ? (
          // The template is the chip: `@`, the card's name and the label are all
          // tokens (or literal text) the reader can keep or drop.
          <ValueTemplate
            template={field.template}
            context={context ?? { label: "", value: "", card: title, type: "" }}
            testId="mention-chip-value"
            valueClassName="mention-chip-field-value"
            labelClassName="mention-chip-field-name"
          />
        ) : (
          <>
            <span aria-hidden="true" className="mention-chip-at">
              @
            </span>
            <span className="mention-chip-title">{title}</span>
          </>
        )}
      </button>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={chipMenuItems(
            field,
            onOpen,
            cardId,
            () => {
              setMenu(null);
              setEditingDisplay(true);
            },
            allowDisplay,
          )}
        />
      ) : null}

      {editingDisplay && field && context ? (
        <DisplayStyleDialog
          fieldName={field.name}
          sample={context}
          template={field.template}
          allowScope={Boolean(onSetDisplay)}
          allowFieldScope={allowFieldScope}
          overridden={field.overridden}
          onApply={(template, scope) => {
            if (scope === "instance" && onSetDisplay) onSetDisplay(template);
            else if (allowFieldScope) onSetFieldDisplay?.(template);
          }}
          onClose={() => setEditingDisplay(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Tiptap node view. Reading the title through the document subscription is what
 * makes a mention follow a peer's rename, and using the snapshot for existence
 * is what turns a trashed target into *Unavailable card*.
 */
/**
 * Which chip a mention draws.
 *
 * Two kinds of mention, and they are different things: one names a card, one names a passage. The choice is made here,
 * with no hook of its own, so each chip keeps its own hooks unconditional — a dispatcher that returned early from a
 * component with hooks would be a rules-of-hooks violation wearing a comment.
 */
export function MentionChipNodeView(props: NodeViewProps) {
  const annotationId =
    typeof props.node.attrs.annotationId === "string" ? props.node.attrs.annotationId : "";
  if (annotationId.length > 0) return <AnnotationMentionChip annotationId={annotationId} />;
  return <CardMentionChip {...props} />;
}

function CardMentionChip({ node, editor, getPos }: NodeViewProps) {
  const cardId = typeof node.attrs.cardId === "string" ? node.attrs.cardId : "";
  const fieldId = typeof node.attrs.fieldId === "string" ? node.attrs.fieldId : "";
  const ownDisplay = typeof node.attrs.display === "string" ? node.attrs.display : "";
  const card = useCard(cardId);
  const title = useCardTitle(cardId);
  const presence = useCardPresence(cardId);
  const types = useTypes();
  const workspace = useCanvasStore((state) => state.workspace);
  const openInspector = useUiStore((state) => state.openInspector);
  const readOnly = useUiStore((state) => state.readOnly);
  const canManageSchema = useUiStore((state) => state.canManageSchema);

  const definition = card && fieldId ? fieldFor(card, fieldId, types) : undefined;
  const value = fieldId ? card?.properties[fieldId] : undefined;
  const linkedCardId = definition?.kind === "card" && typeof value === "string" ? value : "";
  const cardLabel = useCardTitle(linkedCardId);
  const linkedPresence = useCardPresence(linkedCardId);
  const typeName =
    types.find((type) => type.id === (card?.primaryTypeId ?? card?.typeIds[0]))?.name ?? "";

  const field: MentionChipField | undefined =
    definition && card
      ? {
          id: definition.id,
          name: definition.name,
          // The same formatter the body block uses, so both read identically.
          value: propertyBlockDisplayValue(definition, value, cardLabel, linkedPresence),
          fieldTemplate: displayTemplate(definition, MENTION_DISPLAY_TEMPLATE),
          template: ownDisplay || displayTemplate(definition, MENTION_DISPLAY_TEMPLATE),
          typeName,
          overridden: ownDisplay.length > 0,
        }
      : undefined;

  /** Writes the override onto this atom; clearing it removes the attribute. */
  const setOwnDisplay = (template: string | null) => {
    const position = getPos();
    if (position === undefined) return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, {
        ...node.attrs,
        display: template ?? null,
      }),
    );
  };

  return (
    <NodeViewWrapper as="span" className="mention-node" contentEditable={false}>
      <MentionChip
        cardId={cardId}
        title={title}
        presence={presence}
        unavailable={Boolean(card?.deletedAt)}
        field={field}
        onOpen={(id, openFieldId) => openInspector(id, openFieldId ?? null)}
        allowDisplay={!readOnly}
        allowFieldScope={canManageSchema}
        {...(definition && !readOnly
          ? {
              onSetDisplay: setOwnDisplay,
              onSetFieldDisplay: (template: string | null) => {
                const owning = card
                  ? types.find((type) => type.fields.some((entry) => entry.id === definition.id))
                  : undefined;
                if (owning) workspace.updateField(owning.id, definition.id, { display: template });
              },
            }
          : {})}
      />
    </NodeViewWrapper>
  );
}

/**
 * A mention of a highlight.
 *
 * It names the passage rather than the card it became, because that is what a reader means when they mention a
 * highlight: "the sentence about the domain", not "the note I made from it". Pressing it opens the book where the
 * sentence is. A highlight whose record is gone says so — every reference in this app owns its broken state rather
 * than rendering like a card that never existed.
 */
function AnnotationMentionChip({ annotationId }: { annotationId: string }) {
  const workspace = useCanvasStore((state) => state.workspace);
  const annotations = useAnnotations(workspace);
  const styles = workspace?.listAnnotationStyles() ?? [];
  const annotation = annotations.find((entry) => entry.id === annotationId);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  const openAnnotation = useUiStore((state) => state.openAnnotation);

  if (annotation === undefined) {
    return (
      <NodeViewWrapper as="span" className="mention-node" contentEditable={false}>
        <span
          className="mention-chip mention-chip--missing"
          data-testid="annotation-mention-missing"
        >
          a highlight that is gone
        </span>
      </NodeViewWrapper>
    );
  }

  const style = styles.find((entry) => entry.id === annotation.styleId);
  const words =
    annotation.excerpt ??
    (annotation.anchor.kind === "quote" ? annotation.anchor.quote : "A passage");

  return (
    <NodeViewWrapper as="span" className="mention-node" contentEditable={false}>
      <button
        type="button"
        className="mention-chip annotation-mention"
        data-testid="annotation-mention"
        title="Open the book at this passage"
        style={{ borderColor: style?.color ?? "var(--accent)" }}
        onClick={(event) => {
          event.preventDefault();
          // The chip is a reference to a passage, so it opens the passage: the reader turns to that chapter and raises
          // the mark. It used to open the promoted card, which is a different thing the reader may not have made, and
          // the tooltip promised otherwise.
          openAnnotation(annotation.id);
          openCardFocus(annotation.sourceCardId);
        }}
      >
        <span
          aria-hidden="true"
          className="annotation-mention-dot"
          style={{ background: style?.color ?? "var(--accent)" }}
        />
        <span className="annotation-mention-text">
          {words.length <= 48 ? words : `${words.slice(0, 45)}…`}
        </span>
      </button>
    </NodeViewWrapper>
  );
}
