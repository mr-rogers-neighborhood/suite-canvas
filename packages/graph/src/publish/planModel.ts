import type { Card, GraphEdge, PropertyValue, Section } from "../schema.js";
import type { BlockTarget } from "./blocks.js";
import type { PublishLimits } from "./limits.js";
import type { PlacementSnapshot, RichTextSnapshot } from "./snapshot.js";

/**
 * Owns the shapes a plan carries: what a share may publish, the change and conflict
 * records it lists, and the plan object itself.
 */

/** What a share link may publish: one board, or one card. */
export type PublishScope = { scope: "board"; boardId: string } | { scope: "card"; cardId: string };

/** The kinds of change an editor share may publish. */
export type PublishFieldKind =
  | "title"
  | "body"
  | "property"
  | "tag"
  | "placement"
  | "unplace"
  | "section"
  | "edge"
  | "create-card"
  | "create-section"
  | "create-edge";

export interface PublishConflict {
  /** Stable key, e.g. `card:<id>:title`, `board:<id>:card:<id>`, `section:<id>`. */
  key: string;
  kind: PublishFieldKind | "unsupported";
  message: string;
  /** Human label for the dialog; ids stay in the key only. */
  label?: string;
}

export interface PublishChange {
  key: string;
  kind: PublishFieldKind;
  /** Optional details for reporting; apply() never reads them. */
  cardId?: string;
  fieldId?: string;
  tagId?: string;
  boardId?: string;
  sectionId?: string;
  edgeId?: string;
  /** Set on a `body` change that publishes one block instead of the body. */
  block?: BlockTarget;
}

/** A new card captured from the draft, including its required board placement. */
export interface CreatedCardSnapshot {
  id: string;
  typeId: string;
  title: RichTextSnapshot;
  body: RichTextSnapshot;
  properties: Record<string, PropertyValue | null>;
  tags: string[];
  connectors: Card["connectors"];
  placement: PlacementSnapshot;
}

/** The value a change carries, captured from the draft at planning time. */
export type PublishValue =
  | { kind: "text"; tree: RichTextSnapshot }
  | { kind: "body-block"; op: "replace"; block: RichTextSnapshot }
  | { kind: "body-block"; op: "insert"; block: RichTextSnapshot }
  | { kind: "body-block"; op: "remove" }
  | { kind: "property"; value: PropertyValue | null }
  | { kind: "tag"; present: boolean }
  | { kind: "placement"; placement: PlacementSnapshot }
  | { kind: "unplace" }
  | { kind: "section"; section: Section }
  | { kind: "edge"; edge: GraphEdge }
  | { kind: "remove-edge"; edgeId: string }
  | { kind: "create-card"; card: CreatedCardSnapshot }
  | { kind: "create-section"; section: Section }
  | { kind: "create-edge"; edge: GraphEdge };

/**
 * How a caller resolves keys that the draft and the workspace both changed.
 * With `overwrite`, such a key is no longer a conflict: a selected key
 * publishes the draft value, an unselected one keeps the workspace value.
 * Without `overwrite`, every conflicting key rejects the publish.
 */
export interface PublishPlanOptions {
  overwrite?: ReadonlySet<string>;
  /**
   * Overrides the byte and geometry caps a publish enforces. Unset limits fall
   * back to the environment overrides and `DEFAULT_PUBLISH_LIMITS`.
   */
  limits?: Partial<PublishLimits>;
}

export interface PublishPlan {
  scope: PublishScope;
  /** Changes the draft made that the source still matches. */
  changes: PublishChange[];
  /** Keys the draft and the source both changed; a publish is rejected. */
  conflicts: PublishConflict[];
  /** Keys outside what an editor share may publish; a publish is rejected. */
  unsupported: PublishConflict[];
  /**
   * The exact draft values captured when planning, keyed by change key. Apply
   * reads only these, never the live draft, so a plan stays deterministic.
   */
  values: Record<string, PublishValue>;
}
