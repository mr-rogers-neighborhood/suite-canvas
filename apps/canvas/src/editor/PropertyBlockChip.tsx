import type { Card, CardPresence, CardType, FieldDefinition, PropertyValue } from "@suite/graph";
import { displayTemplate, readPropertyValue } from "@suite/graph";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { ContextMenu } from "../components/ContextMenu";
import { DisplayStyleDialog } from "../components/DisplayStyleDialog";
import { FieldValueInput } from "../components/PropertyField";
import { ValueTemplate } from "../components/ValueTemplate";
import { useCardPresence, useCardTitle } from "../hooks/useCardContainers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useCard, useWorkspaceStore } from "../store/workspaceStore";
import type { PropertyBlockOptions } from "./PropertyBlock";

const EM_DASH = "\u2014";

/** Inert styling for an unshared card value: quiet, and never a hover link. */
const NOT_SHARED_VALUE = { color: "var(--ink-muted)", cursor: "default" } as const;
/* No opacity: fading muted ink drops it below 4.5:1 on the chip surface. */
const NOT_SHARED_NOTE = { marginLeft: 3 } as const;

/** The field behind a block, in the card's type order (same as the panel). */
function fieldFor(card: Card, fieldId: string, types: readonly CardType[]) {
  for (const typeId of card.typeIds) {
    const field = types
      .find((type) => type.id === typeId)
      ?.fields.find((candidate) => candidate.id === fieldId);
    if (field) return field;
  }
  return undefined;
}

/** Field definitions change when a type is edited; unrelated changes keep identity. */
function useCardTypes(): CardType[] {
  const store = useWorkspaceStore();
  const get = () => store.getSnapshot().types;
  return useSyncExternalStore(store.subscribe, get, get);
}

/** Compact one-line rendering of a value, using option labels, never ids. */
export function propertyBlockDisplayValue(
  field: FieldDefinition,
  value: PropertyValue | undefined,
  cardLabel = "",
  cardPresence: CardPresence = "card",
): string {
  return readPropertyValue(field, value, {
    cardTitle: cardLabel,
    cardPresence,
    empty: EM_DASH,
  }).text;
}

export interface PropertyBlockChipProps {
  /** Undefined when the field was deleted or belongs to another type. */
  field: FieldDefinition | undefined;
  value: PropertyValue | undefined;
  /** Live title of the card a `card` value points at. */
  cardLabel?: string;
  /** Whether that card is here, only a projection stub, or gone. */
  cardPresence?: CardPresence;
  /** The block's own card, for `{{card}}` and `{{type}}` in its template. */
  cardTitle?: string;
  typeName?: string;
  /** The template in effect: the field's, or this block's override. */
  template?: string;
  /** One property write; `null` clears the key. */
  onCommit: (value: PropertyValue | null) => void;
  /** Read-only kinds are edited in the panel. */
  onOpenPanel: () => void;
  /** Removes the block from the body; the value stays on the card. */
  onRemove?: () => void;
  /** A share viewer reads the block; nothing in it writes. */
  readOnly?: boolean;
}

/**
 * The body's view of one property. Kept presentational so a story or test can
 * render every kind without a workspace; the node view supplies live data.
 */
export function PropertyBlockChip({
  field,
  value,
  cardLabel = "",
  cardPresence = "card",
  cardTitle = "",
  typeName = "",
  template,
  onCommit,
  onOpenPanel,
  onRemove,
  readOnly = false,
}: PropertyBlockChipProps) {
  const [editing, setEditing] = useState(false);

  // A field can disappear while its input is open (a peer edits the type).
  useEffect(() => {
    if (!field) setEditing(false);
  }, [field]);

  if (!field) {
    return (
      <span
        data-testid="property-block-missing"
        className="property-block property-block-missing"
        contentEditable={false}
      >
        Missing field
      </span>
    );
  }

  const reading = readPropertyValue(field, value, {
    cardTitle: cardLabel,
    cardPresence,
    empty: EM_DASH,
  });
  const display = reading.text;
  const opensPanelOnly = field.kind === "card" || field.kind === "multiSelect";

  const stopPointer = (event: { stopPropagation: () => void }) => event.stopPropagation();

  let control: ReactNode;
  if (reading.notShared) {
    // Referenced but not copied: show the title the share kept, inert. It is
    // not an error, so it stays quietly muted and never opens a panel.
    control = (
      <span
        data-testid="property-block-value"
        data-not-shared="true"
        role="note"
        className="property-block-value property-block-readonly property-block-not-shared"
        style={NOT_SHARED_VALUE}
        title={`${display} \u2014 not shared`}
        aria-label={`${display} \u2014 not shared`}
      >
        {display}
        <span className="property-block-note" style={NOT_SHARED_NOTE}>
          {"\u00b7 not shared"}
        </span>
      </span>
    );
  } else if (readOnly) {
    control = (
      <span
        data-testid="property-block-value"
        data-readonly="true"
        className="property-block-value property-block-readonly"
      >
        {display}
      </span>
    );
  } else if (opensPanelOnly) {
    control = (
      <button
        type="button"
        tabIndex={-1}
        title="Edit in the card panel"
        data-testid="property-block-value"
        data-readonly="true"
        className="property-block-value property-block-readonly"
        onPointerDown={stopPointer}
        onMouseDown={stopPointer}
        onClick={(event) => {
          event.stopPropagation();
          onOpenPanel();
        }}
      >
        {display}
      </button>
    );
  } else if (field.kind === "checkbox") {
    control = (
      <button
        type="button"
        tabIndex={-1}
        aria-pressed={value === true}
        aria-label={field.name}
        data-testid="property-block-value"
        className="property-block-value"
        onPointerDown={stopPointer}
        onMouseDown={stopPointer}
        onClick={(event) => {
          event.stopPropagation();
          onCommit(value === true ? null : true);
        }}
      >
        {display}
      </button>
    );
  } else if (editing) {
    control = (
      <FieldValueInput
        field={field}
        value={value}
        onCommit={onCommit}
        autoFocus
        testId="property-block-input"
        className="property-block-input"
        onDone={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    );
  } else {
    control = (
      <button
        type="button"
        tabIndex={-1}
        data-testid="property-block-value"
        className="property-block-value"
        onPointerDown={stopPointer}
        onMouseDown={stopPointer}
        onClick={(event) => {
          event.stopPropagation();
          setEditing(true);
        }}
      >
        {display}
      </button>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only stops the click from starting body editing; the controls inside are buttons and inputs
    // biome-ignore lint/a11y/useKeyWithClickEvents: no action happens here, so there is nothing to trigger from the keyboard
    <span
      data-testid="property-block"
      data-field-id={field.id}
      data-field-kind={field.kind}
      className="property-block"
      contentEditable={false}
      onPointerDown={stopPointer}
      onMouseDown={stopPointer}
      // The block is a control, not body text: clicking it must not start
      // body editing on a read-only surface (the panel turns a click into
      // "edit here"), which would steal focus from the inline input.
      onClick={(event) => event.stopPropagation()}
    >
      {/* One template describes the whole line: label, separators and the
          editable value all come from it, so a block and a chip agree. */}
      <ValueTemplate
        template={template ?? displayTemplate(field)}
        context={{
          label: field.name,
          value: display === EM_DASH ? "" : display,
          card: cardTitle,
          type: typeName,
        }}
        renderValue={control}
        labelClassName="property-block-label"
        valueClassName="property-block-template-value"
        emptyClassName="property-block-template-empty"
      />
      {onRemove && !readOnly ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Remove property block from the body"
          title={`Remove ${field.name} from the body; the value stays on the card`}
          data-testid="property-block-remove"
          className="property-block-remove"
          onPointerDown={stopPointer}
          onMouseDown={stopPointer}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          {"\u00d7"}
        </button>
      ) : null}
    </span>
  );
}

/**
 * Tiptap node view. Reads the card from the snapshot so a panel edit shows up
 * in the block immediately, and writes through the same workspace calls the
 * panel uses — the block never holds a copy of the value.
 */
export function PropertyBlockNodeView({ node, extension, getPos, editor }: NodeViewProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editingDisplay, setEditingDisplay] = useState(false);
  const options = extension.options as PropertyBlockOptions;
  const cardId = options.cardId;
  const fieldId = typeof node.attrs.fieldId === "string" ? node.attrs.fieldId : "";

  const workspace = useCanvasStore((state) => state.workspace);
  const readOnly = useUiStore((state) => state.readOnly);
  const canManageSchema = useUiStore((state) => state.canManageSchema);
  const card = useCard(cardId);
  const types = useCardTypes();
  const field = card ? fieldFor(card, fieldId, types) : undefined;
  const value = card?.properties[fieldId];
  const linkedCardId = field?.kind === "card" && typeof value === "string" ? value : "";
  const cardLabel = useCardTitle(linkedCardId);
  const cardPresence = useCardPresence(linkedCardId);
  const cardTitle = useCardTitle(cardId);
  const typeName =
    types.find((type) => type.id === (card?.primaryTypeId ?? card?.typeIds[0]))?.name ?? "";
  const ownDisplay = typeof node.attrs.display === "string" ? node.attrs.display : "";

  const commit = (next: PropertyValue | null) => {
    try {
      if (next === null) workspace.clearProperty(cardId, fieldId);
      else workspace.setProperty(cardId, fieldId, next);
    } catch {
      // A card or field removed mid-edit leaves the block as a dangling view;
      // it renders *Missing field* on the next snapshot instead of throwing.
    }
  };

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
    <NodeViewWrapper
      as="span"
      className="property-block-node"
      contentEditable={false}
      onContextMenu={(event: React.MouseEvent) => {
        if (!field) return;
        event.preventDefault();
        event.stopPropagation();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <PropertyBlockChip
        field={field}
        value={value}
        cardLabel={cardLabel}
        cardPresence={cardPresence}
        cardTitle={cardTitle}
        typeName={typeName}
        {...(ownDisplay ? { template: ownDisplay } : {})}
        onCommit={commit}
        onOpenPanel={() => options.openPanel(cardId)}
        readOnly={readOnly}
        onRemove={() => {
          // Deleting the atom writes through the editor's own CRDT binding, so
          // peers see the same removal as any other body edit.
          const from = getPos();
          if (from === undefined) return;
          editor
            .chain()
            .focus()
            .deleteRange({ from, to: from + node.nodeSize })
            .run();
        }}
      />

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Open card", onSelect: () => options.openPanel(cardId) },
            ...(field && !readOnly
              ? [
                  {
                    label: "Display\u2026",
                    onSelect: () => {
                      setMenu(null);
                      setEditingDisplay(true);
                    },
                  },
                ]
              : []),
          ]}
        />
      ) : null}

      {editingDisplay && field ? (
        <DisplayStyleDialog
          fieldName={field.name}
          sample={{
            label: field.name,
            value: propertyBlockDisplayValue(field, value, cardLabel, cardPresence),
            card: cardTitle,
            type: typeName,
          }}
          template={ownDisplay || displayTemplate(field)}
          allowScope
          allowFieldScope={canManageSchema}
          overridden={ownDisplay.length > 0}
          onApply={(template, scope) => {
            if (scope !== "instance") {
              if (!canManageSchema) return;
              const owning = types.find((type) =>
                type.fields.some((entry) => entry.id === field.id),
              );
              if (owning) workspace.updateField(owning.id, field.id, { display: template });
              return;
            }
            setOwnDisplay(template);
          }}
          onClose={() => setEditingDisplay(false)}
        />
      ) : null}
    </NodeViewWrapper>
  );
}
