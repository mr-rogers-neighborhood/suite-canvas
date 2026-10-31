import type { ContainerID } from "loro-crdt";
import {
  type Board,
  type Card,
  type CardType,
  type Connector,
  type EdgeEndpointKind,
  type FieldDefinition,
  type GraphEdge,
  type Placement,
  placementSchema,
  type Section,
  type SubField,
  type Tag,
} from "../schema.js";
import type { ViewCollection, ViewKind, ViewLens, ViewQuery, ViewRender } from "../views.js";

/**
 * Owns the public model of the workspace document: the change record observers receive and
 * the inputs and options every mutator takes.
 */

export type WorkspaceSection =
  | "boards"
  | "cards"
  | "placements"
  | "edges"
  | "types"
  | "tags"
  | "sections"
  | "references";

export type WorkspaceAction = "add" | "update" | "delete";

export type LayerAction = "forward" | "front" | "backward" | "back";

export interface WorkspaceChange {
  section: WorkspaceSection;
  action: WorkspaceAction;
  key: string;
  /** `references` changes carry the card's sorted target ids instead of a record. */
  value: Board | Card | Placement | GraphEdge | CardType | Tag | Section | string[] | null;
}

/** Shared text containers for one card, stable until the cards map changes. */
export interface CardContainers {
  contentId: ContainerID | null;
  titleId: ContainerID | null;
}

export interface CreateCardInput {
  id?: string;
  /** Primary type; defaults to the built-in note type. */
  typeId?: string;
  /** Place the card on this board straight away; omit to create it in the inbox. */
  boardId?: string;
  position?: { x: number; y: number };
  /** Preserve an existing connector layout; defaults to a fresh card layout. */
  connectors?: Connector[];
  /**
   * Copy the type's template card, if it has one. Defaults to true, so every
   * ordinary "new card of this type" arrives written. Pass false to build the
   * template itself, or when the caller wants an empty card.
   */
  fromTemplate?: boolean;
  /**
   * Which of the type's templates to copy, when it has more than one.
   *
   * Absent means the first live template, which is the one the editor marks as the default.
   * An id that is not one of the type's live templates copies nothing, because a template
   * from another type arrives wearing fields this card does not have.
   */
  templateId?: string;
}

/**
 * What `WorkspaceDocument.createPortalCard` needs: the board the portal sits on
 * and the board it opens.
 */
export interface CreatePortalCardInput {
  /** Board that holds the portal card. */
  boardId: string;
  /** Board the portal points at; the `board` value stores this id. */
  targetBoardId: string;
  /** Placement on `boardId`; defaults to the top-left corner. */
  position?: { x: number; y: number };
  /**
   * Card size in flow units. A portal opens a real board, so its card is sized
   * to that board's shape when the caller can measure it; omitting this leaves
   * the card at its natural size, exactly like any other card.
   */
  size?: { width: number; height: number };
  id?: string;
}

export interface DuplicateCardOptions {
  /** Board for the copy's placement; omit to create the copy in the inbox. */
  boardId?: string;
  /** Offset from the source card's position on that board; defaults to 24, 24. */
  offset?: { x: number; y: number };
  /**
   * Connector layout for the copy. Omit for a fresh card layout; pass the
   * source's connectors when links will be re-attached to the copy, since a
   * link names its connectors by id.
   */
  connectors?: Connector[];
}

export interface DuplicateBoardOptions {
  /** Name for the new board; defaults to the source's name plus " copy". */
  name?: string;
}

export interface CreateTypeInput {
  id?: string;
  name: string;
  pluralName?: string;
  glyph?: string;
  /** An icon reference ("lucide:book"); the glyph is the fallback. */
  icon?: string;
  color?: string;
}

export interface CreateFieldInput {
  name: string;
  kind: FieldDefinition["kind"];
  required?: boolean;
  /** Initial labels for select and multi-select fields. */
  options?: string[];
  /**
   * A `group`'s members, or a `list`'s item shape
   * (ADR-0057 §6). A list of
   * scalars declares exactly one entry: the item's own kind.
   */
  subFields?: Array<{ id?: string; name: string; kind: SubField["kind"] }>;
  /** For a `list`: repeat the scalar sub-field or a group of them. Defaults to scalar. */
  itemKind?: "scalar" | "group";
  /** For a `rating`: scale top, half steps and icon set. Defaults to five whole marks. */
  rating?: { scale: number; half?: boolean; icon?: string };
}

export interface CardFieldView {
  typeId: string;
  field: FieldDefinition;
}

export interface CreateEdgeInput {
  boardId: string;
  source: string;
  target: string;
  /** Defaults to a card, so existing callers keep working unchanged. */
  sourceKind?: EdgeEndpointKind | undefined;
  targetKind?: EdgeEndpointKind | undefined;
  sourceConnector?: string | undefined;
  targetConnector?: string | undefined;
  kind?: GraphEdge["kind"];
}

export interface PlacementMoveInput {
  cardId: string;
  x: number;
  y: number;
}

export const placementMoveSchema = placementSchema.pick({ cardId: true, x: true, y: true });

/** Shared empty target list; reference arrays are read-only to callers. */
export const NO_REFERENCES: string[] = [];

export interface CreateSectionInput {
  id?: string;
  boardId: string;
  title?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: Section["color"];
  /** Defaults to the same four side midpoints every new card starts with. */
  connectors?: Connector[];
}

/** A saved query, plus where it sits in the Views menu. */
export interface CreateViewInput {
  id?: string;
  name: string;
  /** Defaults to the end of the list. */
  position?: number;
  query: ViewQuery;
  /** How the result is presented; absent reads as a lens, as it always has. */
  kind?: ViewKind;
  /** Cards pulled in by hand, beside the query's rule. */
  context?: { cardIds: string[] };
  lens?: ViewLens;
  collection?: ViewCollection;
  render?: ViewRender;
}

/** What `updateView` may replace. Every field is whole: a view is one saved record. */
export interface UpdateViewInput {
  name?: string;
  query?: ViewQuery;
  kind?: ViewKind;
  context?: { cardIds: string[] };
  lens?: ViewLens;
  collection?: ViewCollection;
  render?: ViewRender;
}
