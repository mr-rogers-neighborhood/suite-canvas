import type { Card, GraphEdge, Section } from "@suite/graph";

/**
 * What `explain` gathers (ADR-0066 §4).
 *
 * The purpose turns a selection into a question: the entities, their types, and the
 * links between them. This module is only the *gathering* half — turning three stores
 * into one list — because that half is pure and worth testing on its own, and because
 * the answering half (the handbook, gate A41) will consume it rather than replace it.
 *
 * Nothing here writes. The context is UI state until the reader saves it, at which
 * point it becomes a view (ADR-0043),
 * which is why there is no `save` in this shape: a view is not a fourth kind of object
 * the context has to learn about.
 */
export interface ExplainEntity {
  id: string;
  /** The reader-facing name, already resolved from rich text. */
  title: string;
  /** "note", "section", or the card's primary type — whatever names the kind. */
  kind: string;
  /** Fields a card carries, in insertion order; empty for sections. */
  fields: ReadonlyArray<{ label: string; value: string }>;
}

export interface ExplainLink {
  id: string;
  /** Both ends are inside the selection by construction, so names not ids. */
  from: string;
  to: string;
  kind: string;
}

export interface ExplainContext {
  entities: readonly ExplainEntity[];
  links: readonly ExplainLink[];
  /** True when something is selected but nothing of it can be explained. */
  partial: boolean;
}

export interface ExplainInput {
  selectedIds: readonly string[];
  cards: readonly Card[];
  sections: readonly Section[];
  edges: readonly GraphEdge[];
  /** Card id → display title, from the live title subscription. */
  titles: ReadonlyMap<string, string>;
  /** Card type id → name. */
  typeNames: ReadonlyMap<string, string>;
}

const EMPTY: ExplainContext = { entities: [], links: [], partial: false };

/** Render one property value the way a reader would say it out loud. */
function fieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(fieldValue).join(", ");
  return JSON.stringify(value);
}

export function explainContext(input: ExplainInput): ExplainContext {
  const selected = new Set(input.selectedIds.filter((id) => id.length > 0));
  if (selected.size === 0) return EMPTY;

  const cards = input.cards.filter((card) => selected.has(card.id) && !card.deletedAt);
  const sections = input.sections.filter((section) => selected.has(section.id));

  const entities: ExplainEntity[] = [
    ...cards.map((card) => ({
      id: card.id,
      // An untitled card still has to be nameable, and "Untitled" is what the canvas
      // shows on it — a blank row would read as a bug.
      title: input.titles.get(card.id)?.trim() || "Untitled",
      kind: input.typeNames.get(card.primaryTypeId) ?? "note",
      fields: Object.entries(card.properties).map(([key, value]) => ({
        label: key,
        value: fieldValue(value),
      })),
    })),
    ...sections.map((section) => ({
      id: section.id,
      title: section.title.trim() || "Untitled section",
      kind: "section",
      fields: [],
    })),
  ];

  const titled = new Map(entities.map((entity) => [entity.id, entity.title]));
  const links = input.edges
    .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      from: titled.get(edge.source) ?? edge.source,
      to: titled.get(edge.target) ?? edge.target,
      kind: edge.label ?? edge.kind,
    }));

  // The selection can name things that are neither cards nor sections — a board tab, a
  // stale id from a peer's delete. Saying so is better than a silently short list.
  return { entities, links, partial: entities.length < selected.size };
}
