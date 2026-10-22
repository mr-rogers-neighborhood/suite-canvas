import type { Card, CardType, FieldDefinition, PropertyValue } from "@suite/graph";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useCardTitle } from "../hooks/useCardContainers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useCard, useWorkspaceStore } from "../store/workspaceStore";
import type { PropertyBlockOptions } from "./PropertyBlock";

const EM_DASH = "\u2014";

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
): string {
  switch (field.kind) {
    case "checkbox":
      return value === true ? "\u2713" : EM_DASH;
    case "select": {
      if (typeof value !== "string") return EM_DASH;
      return field.options.find((option) => option.id === value)?.label ?? value;
    }
    case "multiSelect": {
      const ids = Array.isArray(value) ? value : [];
      if (ids.length === 0) return EM_DASH;
      return ids
        .map((id) => field.options.find((option) => option.id === id)?.label ?? id)
        .join(", ");
    }
    case "card":
      return (
        cardLabel || (typeof value === "string" && value.length > 0 ? "Unavailable card" : EM_DASH)
      );
    case "number":
      return typeof value === "number" ? String(value) : EM_DASH;
    default:
      return typeof value === "string" && value.trim().length > 0 ? value : EM_DASH;
  }
}

export interface PropertyBlockChipProps {
  /** Undefined when the field was deleted or belongs to another type. */
  field: FieldDefinition | undefined;
  value: PropertyValue | undefined;
  /** Live title of the card a `card` value points at. */
  cardLabel?: string;
  /** One property write; `null` clears the key. */
  onCommit: (value: PropertyValue | null) => void;
  /** Read-only kinds are edited in the panel. */
  onOpenPanel: () => void;
  /** Removes the block from the body; the value stays on the card. */
  onRemove?: () => void;
}

/**
 * The body's view of one property. Kept presentational so a story or test can
 * render every kind without a workspace; the node view supplies live data.
 */
export function PropertyBlockChip({
  field,
  value,
  cardLabel = "",
  onCommit,
  onOpenPanel,
  onRemove,
}: PropertyBlockChipProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Escape unmounts the input, and a blur may still arrive afterwards.
  const cancelled = useRef(false);

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

  const display = propertyBlockDisplayValue(field, value, cardLabel);
  const readOnly = field.kind === "card" || field.kind === "multiSelect";

  const beginEditing = () => {
    const current =
      field.kind === "number"
        ? typeof value === "number"
          ? String(value)
          : ""
        : typeof value === "string"
          ? value
          : "";
    setDraft(current);
    cancelled.current = false;
    setEditing(true);
  };

  const commitDraft = () => {
    if (field.kind === "number") {
      if (draft.trim().length === 0) {
        onCommit(null);
        return;
      }
      const parsed = Number(draft);
      if (Number.isFinite(parsed)) onCommit(parsed);
      return;
    }
    if (draft.trim().length === 0) onCommit(null);
    else onCommit(draft);
  };

  const stopPointer = (event: { stopPropagation: () => void }) => event.stopPropagation();

  let control: ReactNode;
  if (readOnly) {
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
  } else if (editing && field.kind === "select") {
    control = (
      <select
        // biome-ignore lint/a11y/noAutofocus: the value was just clicked; the caret belongs here.
        autoFocus
        aria-label={field.name}
        data-testid="property-block-input"
        className="property-block-input"
        value={typeof value === "string" ? value : ""}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            setEditing(false);
          }
        }}
        onChange={(event) => {
          const next = event.target.value;
          onCommit(next.length > 0 ? next : null);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
      >
        <option value="">None</option>
        {field.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (editing) {
    control = (
      <input
        // biome-ignore lint/a11y/noAutofocus: the value was just clicked; the caret belongs here.
        autoFocus
        type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"}
        aria-label={field.name}
        data-testid="property-block-input"
        className="property-block-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onPointerDown={stopPointer}
        onMouseDown={stopPointer}
        onKeyDown={(event) => {
          // The node view also stops these events; this keeps React handlers
          // and ProseMirror's keymap from seeing Enter/Escape twice.
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            setEditing(false);
          }
        }}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          setEditing(false);
          commitDraft();
        }}
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
          beginEditing();
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
      <span className="property-block-label">{field.name}</span>
      <span aria-hidden="true" className="property-block-separator">
        {"\u00b7"}
      </span>
      {control}
      {onRemove ? (
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
  const options = extension.options as PropertyBlockOptions;
  const cardId = options.cardId;
  const fieldId = typeof node.attrs.fieldId === "string" ? node.attrs.fieldId : "";

  const workspace = useCanvasStore((state) => state.workspace);
  const card = useCard(cardId);
  const types = useCardTypes();
  const field = card ? fieldFor(card, fieldId, types) : undefined;
  const value = card?.properties[fieldId];
  const cardLabel = useCardTitle(field?.kind === "card" && typeof value === "string" ? value : "");

  const commit = (next: PropertyValue | null) => {
    try {
      if (next === null) workspace.clearProperty(cardId, fieldId);
      else workspace.setProperty(cardId, fieldId, next);
    } catch {
      // A card or field removed mid-edit leaves the block as a dangling view;
      // it renders *Missing field* on the next snapshot instead of throwing.
    }
  };

  return (
    <NodeViewWrapper as="span" className="property-block-node" contentEditable={false}>
      <PropertyBlockChip
        field={field}
        value={value}
        cardLabel={cardLabel}
        onCommit={commit}
        onOpenPanel={() => options.openPanel(cardId)}
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
    </NodeViewWrapper>
  );
}
