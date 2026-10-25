import type { Card, CardType, FieldDefinition, PropertyValue } from "@suite/graph";
import type { ComponentType } from "react";

/**
 * One place a field kind plugs in ([ADR-0057](../../docs/decisions/0057-fields-can-compose.md)).
 *
 * A kind has to render in four places — the canvas node, the card body, the
 * inspector and a database cell — and a kind that renders in three of them is a
 * bug factory. This registry is that acceptance test in code: a kind with no
 * entry here cannot claim to exist, and adding one never means editing the
 * 1,100-line inspector panel.
 */

export interface FieldEditorProps {
  field: FieldDefinition;
  value: PropertyValue | undefined;
  /** `null` clears the value, which is different from storing an empty string. */
  onCommit: (next: PropertyValue | null) => void;
  autoFocus?: boolean | undefined;
  testId?: string | undefined;
  className?: string | undefined;
  onDone?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  /** Choices for a `card` field. */
  cards?: readonly Card[] | undefined;
  /** Choices for a `board` field. */
  boards?: readonly CardType[] | undefined;
  excludeCardId?: string | undefined;
}

/** What a kind contributes. */
export interface FieldKindEntry {
  kind: string;
  editor: ComponentType<FieldEditorProps>;
  /**
   * The value as text, for a chip, a cell and a canvas summary. Optional: the
   * default prints scalars and reads anything composite as empty, which is the
   * honest reading of a value the caller does not understand.
   */
  format?: (value: PropertyValue | undefined, field: FieldDefinition | undefined) => string;
}

const entries = new Map<string, FieldKindEntry>();

/**
 * Registers a kind. Called at module scope by the module that owns it, so
 * importing that module is what makes the kind exist — the same shape the embed
 * registry uses (ADR-0047).
 */
export function registerFieldKind(entry: FieldKindEntry): void {
  entries.set(entry.kind, entry);
}

export function fieldKindEntry(kind: string): FieldKindEntry | undefined {
  return entries.get(kind);
}

/** Registered kinds, for tests and for a "what can this workspace store" list. */
export function registeredFieldKinds(): string[] {
  return [...entries.keys()].sort();
}

/** Only for tests: forget every registration. */
export function resetFieldKinds(): void {
  entries.clear();
}

/**
 * The text a read-only surface shows. Composite or unknown values read as empty
 * rather than as `[object Object]`.
 */
export function formatFieldValue(
  kind: string,
  value: PropertyValue | undefined,
  field?: FieldDefinition | undefined,
): string {
  const entry = entries.get(kind);
  if (entry?.format) return entry.format(value, field);
  return defaultFormat(value);
}

function defaultFormat(value: PropertyValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return "";
  return String(value);
}
