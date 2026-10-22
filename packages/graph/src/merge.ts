import { getType, isContainer, LoroList, LoroMap, LoroText } from "loro-crdt";
import { placementKey, WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { propertyValueError } from "./property.js";
import {
  edgeIssue,
  type PublishLimits,
  placementIssue,
  resolvePublishLimits,
  richTextBytes,
  sectionIssue,
  utf8ByteLength,
  validateRichTextTree,
} from "./publishValidation.js";
import type {
  Card,
  FieldDefinition,
  GraphEdge,
  Placement,
  PropertyValue,
  Section,
} from "./schema.js";

/**
 * Origin of the single commit a publish writes. It is deliberately its own
 * origin: a publish is one discrete change, with its own undo step, and peers
 * can tell it apart from a live edit.
 */
export const PUBLISH_ORIGIN = "share:publish";

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
}

/** A `LoroText` container serialized to its delta, marks included. */
export interface RichTextTextSnapshot {
  readonly $text: ReturnType<LoroText["toDelta"]>;
}

/**
 * A rich text tree as plain JSON. Maps keep the `loro-prosemirror` shape
 * (`nodeName`, `attributes`, `children`), lists keep order, and text keeps its
 * delta; comparing two of these is a deep comparison of the whole tree.
 */
export type RichTextSnapshot =
  | null
  | string
  | number
  | boolean
  | RichTextSnapshot[]
  | RichTextTextSnapshot
  | { readonly [key: string]: RichTextSnapshot };

/** One card's placement on the shared board, without the derived fields. */
export interface PlacementSnapshot {
  boardId: string;
  cardId: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
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

// ------------------------------------------------------------------ snapshot

function isMap(value: unknown): value is LoroMap {
  return isContainer(value) && getType(value) === "Map";
}

function isList(value: unknown): value is LoroList {
  return isContainer(value) && getType(value) === "List";
}

function isText(value: unknown): value is LoroText {
  return isContainer(value) && getType(value) === "Text";
}

function isTextSnapshot(value: RichTextSnapshot): value is RichTextTextSnapshot {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "$text" in value;
}

function snapshotValue(value: unknown): RichTextSnapshot {
  if (isText(value)) return { $text: value.toDelta() };
  if (isList(value)) return value.toArray().map(snapshotValue);
  if (isMap(value)) {
    const out: Record<string, RichTextSnapshot> = {};
    for (const [key, child] of value.entries()) out[key] = snapshotValue(child);
    return out;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function snapshotText(root: LoroMap | null): RichTextSnapshot {
  return root ? snapshotValue(root) : null;
}

/** Stable JSON, so two equal trees compare equal regardless of key order. */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = sortValue(record[key]);
    return out;
  }
  return value;
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  return JSON.stringify(sortValue(value)) ?? "undefined";
}

function same(left: unknown, right: unknown): boolean {
  return left === right || canonical(left) === canonical(right);
}

interface CardSnapshot {
  title: RichTextSnapshot;
  body: RichTextSnapshot;
  properties: Record<string, PropertyValue | null>;
  tags: string[];
}

function snapshotCard(workspace: WorkspaceDocument, cardId: string): CardSnapshot | null {
  const card = workspace.getCard(cardId);
  if (!card) return null;
  const properties: Record<string, PropertyValue | null> = {};
  for (const [fieldId, value] of Object.entries(card.properties)) {
    properties[fieldId] = Array.isArray(value) ? [...value] : value;
  }
  return {
    title: snapshotText(workspace.peekTitle(cardId)),
    body: snapshotText(workspace.peekContent(cardId)),
    properties,
    tags: [...card.tags].sort(),
  };
}

function placementSnapshot(placement: Placement): PlacementSnapshot {
  return {
    boardId: placement.boardId,
    cardId: placement.cardId,
    x: placement.x,
    y: placement.y,
    z: placement.z,
    ...(placement.width === undefined ? {} : { width: placement.width }),
    ...(placement.height === undefined ? {} : { height: placement.height }),
  };
}

interface SectionFields {
  title: string;
  color: Section["color"] | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

function sectionFields(section: Section): SectionFields {
  return {
    title: section.title,
    color: section.color ?? null,
    x: section.x,
    y: section.y,
    width: section.width,
    height: section.height,
  };
}

interface EdgeFields {
  source: string;
  target: string;
  sourceConnector: string | null;
  targetConnector: string | null;
  path: GraphEdge["path"];
  bidirectional: boolean;
  label: string | null;
}

/** Only the fields a board editor may draw differently. */
function edgeFields(edge: GraphEdge | undefined): EdgeFields | undefined {
  if (!edge) return undefined;
  return {
    source: edge.source,
    target: edge.target,
    sourceConnector: edge.sourceConnector ?? null,
    targetConnector: edge.targetConnector ?? null,
    path: edge.path,
    bidirectional: edge.bidirectional,
    label: edge.label ?? null,
  };
}

/** The field definition a card's type owns; the writer's own resolution rule. */
function fieldForCard(
  workspace: WorkspaceDocument,
  card: Card,
  fieldId: string,
): FieldDefinition | undefined {
  for (const typeId of card.typeIds) {
    const field = workspace.getType(typeId)?.fields.find((entry) => entry.id === fieldId);
    if (field) return field;
  }
  return undefined;
}

function snapshotBytes(value: unknown): number {
  return utf8ByteLength(canonical(value));
}

/**
 * Approximate size of the draft a publish would project. It walks only the
 * scope being published, so an unrelated card cannot block an edit.
 */
function draftBytes(
  draft: WorkspaceDocument,
  cardIds: readonly string[],
  boardId: string | null,
): number {
  let bytes = 0;
  for (const cardId of cardIds) bytes += snapshotBytes(snapshotCard(draft, cardId));
  if (!boardId) return bytes;
  bytes += snapshotBytes(draft.listBoardPlacements(boardId).map(placementSnapshot));
  bytes += snapshotBytes(draft.listSections(boardId).map(sectionFields));
  bytes += snapshotBytes(
    draft
      .listEdges()
      .filter((edge) => edge.boardId === boardId)
      .map(edgeFields),
  );
  return bytes;
}

function cardExistsIn(source: WorkspaceDocument): (cardId: string) => boolean {
  return (cardId) => {
    const card = source.getCard(cardId);
    return card !== undefined && !card.deletedAt;
  };
}

// -------------------------------------------------------------------- planning

function addUnsupported(plan: PublishPlan, key: string, message: string, label?: string): void {
  plan.unsupported.push({ key, kind: "unsupported", message, ...(label ? { label } : {}) });
}

function addConflict(
  plan: PublishPlan,
  key: string,
  kind: PublishFieldKind,
  message: string,
): void {
  plan.conflicts.push({ key, kind, message });
}

function record(plan: PublishPlan, change: PublishChange, value: PublishValue): void {
  plan.changes.push(change);
  plan.values[change.key] = value;
}

/**
 * Records a key the draft and the workspace both changed. The draft value is
 * captured even when the key is not selected, so planning stays deterministic;
 * the change itself is only planned when `overwrite` selects the key.
 */
function resolveConflict(
  plan: PublishPlan,
  options: PublishPlanOptions | undefined,
  change: PublishChange,
  value: PublishValue,
  message: string,
): void {
  plan.values[change.key] = value;
  if (options?.overwrite === undefined) {
    addConflict(plan, change.key, change.kind, message);
    return;
  }
  if (options.overwrite.has(change.key)) plan.changes.push(change);
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

/** Fields the baseline schema defines for one card's types. */
function allowedFieldIds(baseline: WorkspaceDocument, card: Card): Set<string> {
  const ids = new Set<string>();
  for (const typeId of card.typeIds) {
    for (const field of baseline.getType(typeId)?.fields ?? []) ids.add(field.id);
  }
  return ids;
}

/**
 * Rejects the shapes a publish may never carry: new, deleted or trashed cards,
 * and any type or tag definition edit. Everything here is reported instead of
 * ignored, because a projection looks authoritative to the draft that edits it.
 */
function checkStructure(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  scope: PublishScope,
): boolean {
  const draftCards = new Set(draft.doc.getMap(WorkspaceDocument.CARDS_KEY).keys());
  const baselineCards = new Set(baseline.doc.getMap(WorkspaceDocument.CARDS_KEY).keys());
  let ok = true;

  for (const cardId of [...draftCards].sort()) {
    if (baselineCards.has(cardId)) continue;
    if (scope.scope === "board") continue; // Creation is validated by planCreations.
    addUnsupported(
      plan,
      `card:${cardId}`,
      `Card ${cardId} was created in the draft; a card share cannot create cards.`,
    );
    ok = false;
  }
  for (const cardId of [...baselineCards].sort()) {
    if (draftCards.has(cardId)) continue;
    addUnsupported(
      plan,
      `card:${cardId}`,
      `Card ${cardId} was deleted in the draft; publishing cannot delete cards.`,
    );
    ok = false;
  }
  for (const cardId of [...draftCards].sort()) {
    if (!baselineCards.has(cardId)) continue;
    const draftCard = draft.getCard(cardId);
    const baselineCard = baseline.getCard(cardId);
    if (Boolean(draftCard?.deletedAt) === Boolean(baselineCard?.deletedAt)) continue;
    addUnsupported(
      plan,
      `card:${cardId}`,
      `Card ${cardId} was trashed or restored in the draft; publishing cannot move cards to or from the trash.`,
    );
    ok = false;
  }

  const draftTypes = draft.listTypes().sort(byId);
  const baselineTypes = baseline.listTypes().sort(byId);
  if (!same(draftTypes, baselineTypes)) {
    addUnsupported(
      plan,
      "types",
      "The draft changed a type or one of its fields; publishing cannot change the schema.",
    );
    ok = false;
  }

  const draftTags = draft.listTags().sort(byId);
  const baselineTags = baseline.listTags().sort(byId);
  if (!same(draftTags, baselineTags)) {
    addUnsupported(
      plan,
      "tags",
      "The draft changed a tag definition; publishing cannot create, delete or rename tags.",
    );
    ok = false;
  }

  return ok;
}

function planCard(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  cardId: string,
  options: PublishPlanOptions | undefined,
  limits: PublishLimits,
): void {
  const draftCard = draft.getCard(cardId);
  const baselineCard = baseline.getCard(cardId);
  if (!draftCard || !baselineCard) return;

  if (
    !same(draftCard.typeIds, baselineCard.typeIds) ||
    draftCard.primaryTypeId !== baselineCard.primaryTypeId
  ) {
    addUnsupported(
      plan,
      `card:${cardId}:type`,
      `The type of card ${cardId} changed in the draft; publishing cannot change a card's type.`,
    );
  }

  const baselineTagIds = new Set(baseline.doc.getMap(WorkspaceDocument.TAGS_KEY).keys());
  for (const tagId of [...draftCard.tags].sort()) {
    if (baselineTagIds.has(tagId)) continue;
    addUnsupported(
      plan,
      `card:${cardId}:tag:${tagId}`,
      `Tag ${tagId} is not part of the shared workspace; publishing cannot create tags.`,
    );
  }

  const fieldIds = allowedFieldIds(baseline, baselineCard);
  for (const fieldId of Object.keys(draftCard.properties).sort()) {
    if (fieldIds.has(fieldId)) continue;
    addUnsupported(
      plan,
      `card:${cardId}:field:${fieldId}`,
      `Field ${fieldId} is not part of the shared schema; publishing cannot add fields.`,
    );
  }

  const draftSnapshot = snapshotCard(draft, cardId);
  const baselineSnapshot = snapshotCard(baseline, cardId);
  const sourceSnapshot = snapshotCard(source, cardId);
  if (!draftSnapshot || !baselineSnapshot) return;

  let textChanged = false;
  for (const kind of ["title", "body"] as const) {
    const key = `card:${cardId}:${kind}`;
    const draftValue = draftSnapshot[kind];
    const baselineValue = baselineSnapshot[kind];
    if (same(draftValue, baselineValue)) continue;
    // A draft can be written past the editor schema; a publish may not replay it.
    const issue = validateRichTextTree(draftValue, limits);
    if (issue) {
      addUnsupported(plan, key, `The ${kind} of card ${cardId} cannot be published: ${issue}.`);
      continue;
    }
    textChanged = true;
    if (sourceSnapshot && same(sourceSnapshot[kind], baselineValue)) {
      record(plan, { key, kind, cardId }, { kind: "text", tree: draftValue });
      continue;
    }
    resolveConflict(
      plan,
      options,
      { key, kind, cardId },
      { kind: "text", tree: draftValue },
      `The ${kind} of card ${cardId} changed in the workspace after this draft was taken.`,
    );
  }
  if (textChanged) {
    const bytes = richTextBytes(draftSnapshot.title) + richTextBytes(draftSnapshot.body);
    if (bytes > limits.maxCardTextBytes) {
      addUnsupported(
        plan,
        `card:${cardId}:text`,
        `Card ${cardId} holds ${bytes} bytes of text; the publish limit is ${limits.maxCardTextBytes} bytes.`,
      );
    }
  }

  const propertyIds = new Set([
    ...Object.keys(draftSnapshot.properties),
    ...Object.keys(baselineSnapshot.properties),
  ]);
  for (const fieldId of [...propertyIds].sort()) {
    // A field the draft invented is already reported as unsupported.
    if (!fieldIds.has(fieldId)) continue;
    const draftValue = draftSnapshot.properties[fieldId] ?? null;
    const baselineValue = baselineSnapshot.properties[fieldId] ?? null;
    if (same(draftValue, baselineValue)) continue;
    const key = `card:${cardId}:field:${fieldId}`;
    // The draft may hold a value no writer would accept; report it instead of
    // replaying it, because apply reads only what the plan captured.
    const field = fieldForCard(baseline, baselineCard, fieldId);
    const issue = field
      ? propertyValueError(field, draftValue, {
          cardId,
          cardExists: cardExistsIn(source),
        })
      : `Field ${fieldId} is missing from the shared schema`;
    if (issue) {
      addUnsupported(plan, key, `${issue}; the draft value cannot be published.`);
      continue;
    }
    const sourceValue = sourceSnapshot?.properties[fieldId] ?? null;
    if (!sourceSnapshot || !same(sourceValue, baselineValue)) {
      resolveConflict(
        plan,
        options,
        { key, kind: "property", cardId, fieldId },
        { kind: "property", value: draftValue },
        `Field ${fieldId} of card ${cardId} changed in the workspace after this draft was taken.`,
      );
      continue;
    }
    record(
      plan,
      { key, kind: "property", cardId, fieldId },
      { kind: "property", value: draftValue },
    );
  }

  const tagIds = new Set([...draftSnapshot.tags, ...baselineSnapshot.tags]);
  for (const tagId of [...tagIds].sort()) {
    if (!baselineTagIds.has(tagId)) continue;
    const present = draftSnapshot.tags.includes(tagId);
    if (present === baselineSnapshot.tags.includes(tagId)) continue;
    const key = `card:${cardId}:tag:${tagId}`;
    const sourcePresent = sourceSnapshot?.tags.includes(tagId) ?? false;
    if (!sourceSnapshot || sourcePresent !== baselineSnapshot.tags.includes(tagId)) {
      resolveConflict(
        plan,
        options,
        { key, kind: "tag", cardId, tagId },
        { kind: "tag", present },
        `Tag ${tagId} on card ${cardId} changed in the workspace after this draft was taken.`,
      );
      continue;
    }
    record(plan, { key, kind: "tag", cardId, tagId }, { kind: "tag", present });
  }
}

function planPlacements(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  boardId: string,
  cardIds: readonly string[],
  options: PublishPlanOptions | undefined,
  limits: PublishLimits,
): void {
  for (const cardId of cardIds) {
    const key = `board:${boardId}:card:${cardId}`;
    const draftPlacement = draft.getPlacement(boardId, cardId);
    const baselinePlacement = baseline.getPlacement(boardId, cardId);
    const draftSnapshot = draftPlacement ? placementSnapshot(draftPlacement) : undefined;
    const baselineSnapshot = baselinePlacement ? placementSnapshot(baselinePlacement) : undefined;
    const sourcePlacement = source.getPlacement(boardId, cardId);
    const sourceSnapshot = sourcePlacement ? placementSnapshot(sourcePlacement) : undefined;

    if (draftSnapshot && !baselineSnapshot) {
      // A brand-new draft card carries its own placement in the creation change.
      if (!source.getCard(cardId)) continue;
      addUnsupported(
        plan,
        key,
        `Card ${cardId} was placed on this board by the draft; publishing cannot add placements for cards that were not already on the board.`,
      );
      continue;
    }
    if (!draftSnapshot) {
      if (!baselineSnapshot) continue;
      if (!sourceSnapshot || !same(sourceSnapshot, baselineSnapshot)) {
        resolveConflict(
          plan,
          options,
          { key, kind: "unplace", cardId, boardId },
          { kind: "unplace" },
          `Card ${cardId} was moved or removed on this board in the workspace after this draft was taken.`,
        );
        continue;
      }
      record(plan, { key, kind: "unplace", cardId, boardId }, { kind: "unplace" });
      continue;
    }
    if (!baselineSnapshot) continue;
    if (same(draftSnapshot, baselineSnapshot)) continue;
    const issue = placementIssue(draftSnapshot, limits);
    if (issue) {
      addUnsupported(plan, key, issue);
      continue;
    }
    if (!sourceSnapshot || !same(sourceSnapshot, baselineSnapshot)) {
      resolveConflict(
        plan,
        options,
        { key, kind: "placement", cardId, boardId },
        { kind: "placement", placement: draftSnapshot },
        `Card ${cardId} was moved or resized on this board in the workspace after this draft was taken.`,
      );
      continue;
    }
    record(
      plan,
      { key, kind: "placement", cardId, boardId },
      { kind: "placement", placement: draftSnapshot },
    );
  }
}

function planSections(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  boardId: string,
  options: PublishPlanOptions | undefined,
  limits: PublishLimits,
): void {
  const draftSections = new Map(
    draft.listSections(boardId).map((section) => [section.id, section]),
  );
  const baselineSections = new Map(
    baseline.listSections(boardId).map((section) => [section.id, section]),
  );
  const sourceSections = new Map(
    source.listSections(boardId).map((section) => [section.id, section]),
  );

  const ids = new Set([...draftSections.keys(), ...baselineSections.keys()]);
  for (const sectionId of [...ids].sort()) {
    const key = `section:${sectionId}`;
    const draftSection = draftSections.get(sectionId);
    const baselineSection = baselineSections.get(sectionId);
    if (draftSection && !baselineSection) continue; // Creation is validated by planCreations.
    if (!draftSection) {
      addUnsupported(
        plan,
        key,
        `Section ${sectionId} was deleted in the draft; publishing cannot delete sections.`,
      );
      continue;
    }
    if (!baselineSection) continue;
    const draftValue = sectionFields(draftSection);
    if (same(draftValue, sectionFields(baselineSection))) continue;
    const issue = sectionIssue(draftSection, limits);
    if (issue) {
      addUnsupported(plan, key, issue);
      continue;
    }
    const sourceSection = sourceSections.get(sectionId);
    if (!sourceSection || !same(sectionFields(sourceSection), sectionFields(baselineSection))) {
      resolveConflict(
        plan,
        options,
        { key, kind: "section", sectionId, boardId },
        { kind: "section", section: draftSection },
        `Section ${sectionId} changed in the workspace after this draft was taken.`,
      );
      continue;
    }
    record(
      plan,
      { key, kind: "section", sectionId, boardId },
      { kind: "section", section: draftSection },
    );
  }
}

function planEdges(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  boardId: string,
  options: PublishPlanOptions | undefined,
  limits: PublishLimits,
): void {
  // Raw edges, not `listBoardEdges`: that view drops an arrow when an endpoint
  // is unplaced, and unplacing a card must not read as deleting its arrows.
  const draftEdges = new Map(
    draft
      .listEdges()
      .filter((edge) => edge.boardId === boardId)
      .map((edge) => [edge.id, edge]),
  );
  const baselineEdges = new Map(
    baseline
      .listEdges()
      .filter((edge) => edge.boardId === boardId)
      .map((edge) => [edge.id, edge]),
  );
  const sourceEdges = new Map(
    source
      .listEdges()
      .filter((edge) => edge.boardId === boardId)
      .map((edge) => [edge.id, edge]),
  );

  const ids = new Set([...draftEdges.keys(), ...baselineEdges.keys()]);
  for (const edgeId of [...ids].sort()) {
    const key = `edge:${edgeId}`;
    const draftEdge = draftEdges.get(edgeId);
    const baselineEdge = baselineEdges.get(edgeId);
    if (draftEdge && !baselineEdge) continue; // Creation is validated by planCreations.
    if (!draftEdge) {
      if (!baselineEdge) continue;
      const sourceEdge = sourceEdges.get(edgeId);
      if (!same(edgeFields(sourceEdge), edgeFields(baselineEdge))) {
        resolveConflict(
          plan,
          options,
          { key, kind: "edge", edgeId, boardId },
          { kind: "remove-edge", edgeId },
          `Edge ${edgeId} changed in the workspace after this draft was taken.`,
        );
        continue;
      }
      record(plan, { key, kind: "edge", edgeId, boardId }, { kind: "remove-edge", edgeId });
      continue;
    }
    if (!baselineEdge) continue;
    if (draftEdge.kind !== baselineEdge.kind) {
      addUnsupported(
        plan,
        key,
        `Edge ${edgeId} changed kind in the draft; publishing cannot change what an arrow means.`,
      );
      continue;
    }
    if (same(edgeFields(draftEdge), edgeFields(baselineEdge))) continue;
    const issue = edgeIssue(draftEdge, limits, {
      isCardLive: cardExistsIn(source),
    });
    if (issue) {
      addUnsupported(plan, key, issue);
      continue;
    }
    const sourceEdge = sourceEdges.get(edgeId);
    if (!same(edgeFields(sourceEdge), edgeFields(baselineEdge))) {
      resolveConflict(
        plan,
        options,
        { key, kind: "edge", edgeId, boardId },
        { kind: "edge", edge: draftEdge },
        `Edge ${edgeId} changed in the workspace after this draft was taken.`,
      );
      continue;
    }
    record(plan, { key, kind: "edge", edgeId, boardId }, { kind: "edge", edge: draftEdge });
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isCanonicalUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function cardLabel(draft: WorkspaceDocument, cardId: string): string {
  const title = draft.displayTitle(cardId).trim();
  return title.length > 0 ? `Card "${title}"` : "Untitled card";
}

function sectionLabel(section: Section): string {
  return section.title.trim().length > 0 ? `Section "${section.title}"` : "Untitled section";
}

function edgeLabel(edge: GraphEdge): string {
  return edge.label?.trim() ? `Edge "${edge.label}"` : `Edge ${edge.source} to ${edge.target}`;
}

/** New cards, sections and edges are explicit creation changes, never relaxed edits. */
function planCreations(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  scope: PublishScope,
  limits: PublishLimits,
): void {
  if (scope.scope !== "board") return;
  const boardId = scope.boardId;
  const sourceBoard = source.getBoard(boardId);
  const draftCards = new Set(draft.doc.getMap(WorkspaceDocument.CARDS_KEY).keys());
  const baselineCards = new Set(baseline.doc.getMap(WorkspaceDocument.CARDS_KEY).keys());
  const baselineSections = new Set(baseline.listSections(boardId).map((section) => section.id));
  const baselineEdges = new Set(
    baseline
      .listEdges()
      .filter((edge) => edge.boardId === boardId)
      .map((edge) => edge.id),
  );
  const draftCardsById = new Set([...draftCards]);
  const isCardLive = (cardId: string) =>
    Boolean(source.getPlacement(boardId, cardId) || draftCardsById.has(cardId));

  if (!sourceBoard) {
    const hasNewCards = [...draftCards].some((id) => !baselineCards.has(id));
    const hasNewSections = draft
      .listSections(boardId)
      .some((section) => !baselineSections.has(section.id));
    const hasNewEdges = draft
      .listEdges()
      .some((edge) => edge.boardId === boardId && !baselineEdges.has(edge.id));
    if (hasNewCards || hasNewSections || hasNewEdges) {
      addUnsupported(
        plan,
        `board:${boardId}:create`,
        "The shared board no longer exists in the workspace.",
      );
    }
    return;
  }

  for (const cardId of [...draftCards].filter((id) => !baselineCards.has(id)).sort()) {
    const label = cardLabel(draft, cardId);
    const key = `card:${cardId}:create`;
    if (!isCanonicalUuid(cardId)) {
      addUnsupported(plan, key, "A new card id is not a canonical UUID.", label);
      continue;
    }
    if (source.getCard(cardId)) {
      addUnsupported(
        plan,
        key,
        "A card with this id already exists in the workspace; the draft reused it.",
        label,
      );
      continue;
    }
    const card = draft.getCard(cardId);
    if (!card || card.deletedAt) {
      addUnsupported(plan, key, "The new card is missing or trashed in the draft.", label);
      continue;
    }
    if (card.typeIds.length !== 1 || card.primaryTypeId !== card.typeIds[0]) {
      addUnsupported(plan, key, "A new card must have exactly one primary type.", label);
      continue;
    }
    const type = source.getType(card.primaryTypeId);
    if (!type) {
      addUnsupported(
        plan,
        key,
        `The type "${card.primaryTypeId}" no longer exists in the workspace.`,
        label,
      );
      continue;
    }
    const placements = draft.listCardPlacements(cardId);
    if (placements.length !== 1 || placements[0]?.boardId !== boardId) {
      addUnsupported(
        plan,
        key,
        "A new card must be placed on the shared board and nowhere else.",
        label,
      );
      continue;
    }
    const placement = placements[0];
    if (!placement) {
      addUnsupported(plan, key, "The new card has no placement.", label);
      continue;
    }
    const placementProblem = placementIssue(placementSnapshot(placement), limits);
    if (placementProblem) {
      addUnsupported(plan, key, placementProblem, label);
      continue;
    }
    const snapshot = snapshotCard(draft, cardId);
    if (!snapshot) {
      addUnsupported(plan, key, "The new card could not be read.", label);
      continue;
    }
    const textBytes = richTextBytes(snapshot.title) + richTextBytes(snapshot.body);
    if (textBytes > limits.maxCardTextBytes) {
      addUnsupported(
        plan,
        key,
        `The new card holds ${textBytes} bytes of text; the per-card limit is ${limits.maxCardTextBytes}.`,
        label,
      );
      continue;
    }
    const titleProblem = validateRichTextTree(snapshot.title, limits);
    if (titleProblem) {
      addUnsupported(plan, key, titleProblem, label);
      continue;
    }
    const bodyProblem = validateRichTextTree(snapshot.body, limits);
    if (bodyProblem) {
      addUnsupported(plan, key, bodyProblem, label);
      continue;
    }
    for (const [fieldId, value] of Object.entries(snapshot.properties)) {
      const field = type.fields.find((entry) => entry.id === fieldId);
      if (!field) {
        addUnsupported(plan, key, `Field "${fieldId}" is not part of type "${type.name}".`, label);
        break;
      }
      const problem = propertyValueError(field, value, {
        cardId,
        cardExists: (target) => target !== cardId && isCardLive(target),
      });
      if (problem) {
        addUnsupported(plan, key, problem, label);
        break;
      }
    }
    if (plan.unsupported.some((entry) => entry.key === key)) continue;
    for (const tagId of snapshot.tags) {
      if (source.getTag(tagId)) continue;
      addUnsupported(plan, key, `Tag "${tagId}" no longer exists in the workspace.`, label);
      break;
    }
    if (plan.unsupported.some((entry) => entry.key === key)) continue;
    record(
      plan,
      { key, kind: "create-card", cardId, boardId },
      {
        kind: "create-card",
        card: {
          id: cardId,
          typeId: card.primaryTypeId,
          title: snapshot.title,
          body: snapshot.body,
          properties: snapshot.properties,
          tags: snapshot.tags,
          connectors: card.connectors,
          placement: placementSnapshot(placement),
        },
      },
    );
  }

  const sourceSections = new Set(source.listSections(boardId).map((section) => section.id));
  for (const section of draft.listSections(boardId)) {
    if (baselineSections.has(section.id)) continue;
    const key = `section:${section.id}:create`;
    const label = sectionLabel(section);
    if (!isCanonicalUuid(section.id)) {
      addUnsupported(plan, key, "A new section id is not a canonical UUID.", label);
      continue;
    }
    if (sourceSections.has(section.id)) {
      addUnsupported(plan, key, "A section with this id already exists in the workspace.", label);
      continue;
    }
    const problem = sectionIssue(section, limits);
    if (problem) {
      addUnsupported(plan, key, problem, label);
      continue;
    }
    record(
      plan,
      { key, kind: "create-section", sectionId: section.id, boardId },
      {
        kind: "create-section",
        section,
      },
    );
  }

  const sourceEdges = new Set(
    source
      .listEdges()
      .filter((edge) => edge.boardId === boardId)
      .map((edge) => edge.id),
  );
  for (const edge of draft.listEdges().filter((entry) => entry.boardId === boardId)) {
    if (baselineEdges.has(edge.id)) continue;
    const key = `edge:${edge.id}:create`;
    const label = edgeLabel(edge);
    if (!isCanonicalUuid(edge.id)) {
      addUnsupported(plan, key, "A new edge id is not a canonical UUID.", label);
      continue;
    }
    if (sourceEdges.has(edge.id)) {
      addUnsupported(plan, key, "An edge with this id already exists in the workspace.", label);
      continue;
    }
    const problem = edgeIssue(edge, limits, { isCardLive });
    if (problem) {
      addUnsupported(plan, key, problem, label);
      continue;
    }
    record(
      plan,
      { key, kind: "create-edge", edgeId: edge.id, boardId },
      {
        kind: "create-edge",
        edge,
      },
    );
  }
}

function planPublishInto(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  scope: PublishScope,
  options: PublishPlanOptions | undefined,
  limits: PublishLimits,
): void {
  if (!checkStructure(plan, draft, baseline, scope)) return;

  if (scope.scope === "card") {
    const cardId = scope.cardId;
    const draftCard = draft.getCard(cardId);
    const baselineCard = baseline.getCard(cardId);
    if (!draftCard || draftCard.deletedAt) {
      addUnsupported(plan, `card:${cardId}`, `Card ${cardId} is missing or trashed in the draft.`);
      return;
    }
    if (!baselineCard || baselineCard.deletedAt) {
      addUnsupported(
        plan,
        `card:${cardId}`,
        `Card ${cardId} is missing or trashed in the baseline.`,
      );
      return;
    }
    const bytes = draftBytes(draft, [cardId], null);
    if (bytes > limits.maxDraftBytes) {
      addUnsupported(
        plan,
        "publish:size",
        `The draft holds ${bytes} bytes; publishing is limited to ${limits.maxDraftBytes} bytes.`,
      );
      return;
    }
    planCard(plan, draft, baseline, source, cardId, options, limits);
    return;
  }

  const boardId = scope.boardId;
  const draftPlacements = draft.listBoardPlacements(boardId);
  const baselinePlacements = baseline.listBoardPlacements(boardId);
  const cardIds = [
    ...new Set([
      ...draftPlacements.map((placement) => placement.cardId),
      ...baselinePlacements.map((placement) => placement.cardId),
    ]),
  ].sort();

  const bytes = draftBytes(draft, cardIds, boardId);
  if (bytes > limits.maxDraftBytes) {
    addUnsupported(
      plan,
      "publish:size",
      `The draft holds ${bytes} bytes; publishing is limited to ${limits.maxDraftBytes} bytes.`,
    );
    return;
  }

  for (const cardId of cardIds) planCard(plan, draft, baseline, source, cardId, options, limits);
  planPlacements(plan, draft, baseline, source, boardId, cardIds, options, limits);
  planSections(plan, draft, baseline, source, boardId, options, limits);
  planEdges(plan, draft, baseline, source, boardId, options, limits);
  planCreations(plan, draft, baseline, source, scope, limits);
}

/**
 * Computes what a publish would do. Pure: it only reads the three documents.
 *
 * The draft is authoritative only where it differs from the baseline. A key the
 * source changed since the baseline and the draft also changed is a conflict;
 * a key only the source changed keeps the source value and is not a change.
 *
 * `options.overwrite` resolves those conflicts: a selected key publishes the
 * draft value, an unselected one keeps the source value. Unsupported changes
 * reject the publish either way.
 *
 * Every drafted value is validated against the field schema, the editor's rich
 * text schema and the geometry caps before it can be captured. A value the
 * reader cannot even parse is reported as unsupported, so a malformed draft
 * fails closed instead of throwing or partially applying.
 */
export function planPublish(
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  scope: PublishScope,
  options?: PublishPlanOptions,
): PublishPlan {
  const plan: PublishPlan = {
    scope,
    changes: [],
    conflicts: [],
    unsupported: [],
    values: {},
  };
  const limits = resolvePublishLimits(options?.limits);
  try {
    planPublishInto(plan, draft, baseline, source, scope, options, limits);
  } catch (error) {
    plan.changes = [];
    plan.conflicts = [];
    plan.values = {};
    addUnsupported(
      plan,
      "publish:malformed",
      `The draft contains a malformed value and cannot be published (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  return plan;
}

// ----------------------------------------------------------------------- apply

function overwriteText(target: LoroText, delta: ReturnType<LoroText["toDelta"]>): void {
  if (target.length > 0) target.delete(0, target.length);
  if (delta.length > 0) target.applyDelta(delta);
}

function overwriteList(target: LoroList, snapshot: readonly RichTextSnapshot[]): void {
  target.clear();
  snapshot.forEach((value, index) => {
    if (isTextSnapshot(value)) {
      overwriteText(target.insertContainer(index, new LoroText()), value.$text);
      return;
    }
    if (Array.isArray(value)) {
      const list = target.insertContainer(index, new LoroList());
      overwriteList(list, value);
      return;
    }
    if (value !== null && typeof value === "object") {
      const map = target.insertContainer(index, new LoroMap());
      overwriteMap(map, value);
      return;
    }
    if (value !== null) target.insert(index, value);
  });
}

/**
 * Replaces a container's contents with a snapshot. `clear()` frees the keys, but
 * `ensureMergeable*` may hand back the container it just detached, so every child
 * is cleared before it is filled; applying the same snapshot twice is a no-op.
 */
function overwriteMap(
  target: LoroMap,
  snapshot: { readonly [key: string]: RichTextSnapshot },
): void {
  target.clear();
  for (const [key, value] of Object.entries(snapshot)) {
    if (isTextSnapshot(value)) {
      overwriteText(target.ensureMergeableText(key), value.$text);
      continue;
    }
    if (Array.isArray(value)) {
      overwriteList(target.ensureMergeableList(key), value);
      continue;
    }
    if (value !== null && typeof value === "object") {
      overwriteMap(target.ensureMergeableMap(key), value);
      continue;
    }
    target.set(key, value);
  }
}

/** Writes a rich text tree into an existing root container, changed or not. */
function writeRichText(target: LoroMap, snapshot: RichTextSnapshot): void {
  if (
    snapshot !== null &&
    typeof snapshot === "object" &&
    !Array.isArray(snapshot) &&
    !isTextSnapshot(snapshot)
  ) {
    overwriteMap(target, snapshot);
    return;
  }
  target.clear();
}

function placementFields(
  source: WorkspaceDocument,
  boardId: string,
  cardId: string,
): LoroMap | null {
  const value = source.doc
    .getMap(WorkspaceDocument.PLACEMENTS_KEY)
    .get(placementKey(boardId, cardId));
  return isMap(value) ? value : null;
}

function applyChange(
  source: WorkspaceDocument,
  change: PublishChange,
  value: PublishValue,
): boolean {
  switch (change.kind) {
    case "title":
    case "body": {
      if (value.kind !== "text" || !change.cardId) return false;
      const cardId = change.cardId;
      if (!source.getCard(cardId)) return false;
      const existing =
        change.kind === "title" ? source.peekTitle(cardId) : source.peekContent(cardId);
      if (!existing) {
        if (value.tree === null) return false;
        const created =
          change.kind === "title" ? source.getTitle(cardId) : source.getContent(cardId);
        writeRichText(created, value.tree);
        return true;
      }
      if (same(snapshotText(existing), value.tree)) return false;
      writeRichText(existing, value.tree);
      return true;
    }

    case "property": {
      if (value.kind !== "property" || !change.cardId || !change.fieldId) return false;
      const card = source.getCard(change.cardId);
      if (!card) return false;
      if (!allowedFieldIds(source, card).has(change.fieldId)) return false;
      source.setProperty(change.cardId, change.fieldId, value.value);
      return true;
    }

    case "tag": {
      if (value.kind !== "tag" || !change.cardId || !change.tagId) return false;
      const card = source.getCard(change.cardId);
      if (!card || !source.getTag(change.tagId)) return false;
      if (card.tags.includes(change.tagId) === value.present) return false;
      if (value.present) source.addCardTag(change.cardId, change.tagId);
      else source.removeCardTag(change.cardId, change.tagId);
      return true;
    }

    case "unplace": {
      if (!change.cardId || !change.boardId) return false;
      if (!source.getPlacement(change.boardId, change.cardId)) return false;
      source.unplaceCard(change.boardId, change.cardId);
      return true;
    }

    case "create-card": {
      if (value.kind !== "create-card") return false;
      const card = value.card;
      if (source.getCard(card.id)) return false;
      if (!source.getType(card.typeId)) return false;
      const placement = card.placement;
      if (placement.boardId !== change.boardId) return false;
      source.createCard({
        id: card.id,
        typeId: card.typeId,
        boardId: placement.boardId,
        position: { x: placement.x, y: placement.y },
        connectors: card.connectors,
      });
      writeRichText(source.getTitle(card.id), card.title);
      writeRichText(source.getContent(card.id), card.body);
      for (const [fieldId, value] of Object.entries(card.properties)) {
        if (value !== null) source.setProperty(card.id, fieldId, value);
      }
      for (const tagId of card.tags) source.addCardTag(card.id, tagId);
      const fields = placementFields(source, placement.boardId, card.id);
      if (fields) {
        fields.set("z", placement.z);
        if (placement.width === undefined) fields.delete("width");
        else fields.set("width", placement.width);
        if (placement.height === undefined) fields.delete("height");
        else fields.set("height", placement.height);
      }
      return true;
    }

    case "create-section": {
      if (value.kind !== "create-section") return false;
      const section = value.section;
      if (source.getSection(section.id)) return false;
      if (!source.getBoard(section.boardId)) return false;
      source.createSection({
        id: section.id,
        boardId: section.boardId,
        title: section.title,
        x: section.x,
        y: section.y,
        width: section.width,
        height: section.height,
        ...(section.color ? { color: section.color } : {}),
      });
      const fields = source.doc.getMap(WorkspaceDocument.SECTIONS_KEY).get(section.id);
      if (isMap(fields)) fields.set("z", section.z);
      return true;
    }

    case "create-edge": {
      if (value.kind !== "create-edge") return false;
      const edge = value.edge;
      if (source.getEdge(edge.id)) return false;
      if (!source.getBoard(edge.boardId)) return false;
      if (!source.getCard(edge.source) || !source.getCard(edge.target)) return false;
      source.setEdge(edge);
      return true;
    }

    case "placement": {
      if (value.kind !== "placement") return false;
      const placement = value.placement;
      let current = source.getPlacement(placement.boardId, placement.cardId);
      if (!current) {
        // An overwrite selection can restore a placement the workspace removed;
        // a plan never contains one the baseline did not have.
        if (!source.getCard(placement.cardId)) return false;
        source.placeCard(placement.boardId, placement.cardId, {
          x: placement.x,
          y: placement.y,
        });
        current = source.getPlacement(placement.boardId, placement.cardId);
        if (!current) return false;
      }
      let changed = false;
      if (current.x !== placement.x || current.y !== placement.y) {
        source.movePlacements(placement.boardId, [
          { cardId: placement.cardId, x: placement.x, y: placement.y },
        ]);
        changed = true;
      }
      const resized = current.width !== placement.width || current.height !== placement.height;
      if (resized) {
        if (placement.width !== undefined && placement.height !== undefined) {
          source.updatePlacementSize(placement.boardId, placement.cardId, {
            width: placement.width,
            height: placement.height,
          });
        } else {
          // A cleared dimension has no setter; the placement map is the same
          // one movePlacements writes, so this stays a layout write.
          const fields = placementFields(source, placement.boardId, placement.cardId);
          if (fields) {
            if (placement.width === undefined) fields.delete("width");
            else fields.set("width", placement.width);
            if (placement.height === undefined) fields.delete("height");
            else fields.set("height", placement.height);
          }
        }
        changed = true;
      }
      if (current.z !== placement.z) {
        const fields = placementFields(source, placement.boardId, placement.cardId);
        if (fields) {
          fields.set("z", placement.z);
          changed = true;
        }
      }
      return changed;
    }

    case "section": {
      if (value.kind !== "section") return false;
      const next = value.section;
      const current = source.getSection(next.id);
      if (!current) return false;
      let changed = false;
      if (current.title !== next.title) {
        source.renameSection(next.id, next.title);
        changed = true;
      }
      if ((current.color ?? null) !== (next.color ?? null)) {
        source.setSectionColor(next.id, next.color ?? null);
        changed = true;
      }
      if (
        current.x !== next.x ||
        current.y !== next.y ||
        current.width !== next.width ||
        current.height !== next.height
      ) {
        source.updateSectionGeometry(next.id, {
          x: next.x,
          y: next.y,
          width: next.width,
          height: next.height,
        });
        changed = true;
      }
      return changed;
    }

    case "edge": {
      if (value.kind === "remove-edge") {
        if (!source.getEdge(value.edgeId)) return false;
        source.removeEdge(value.edgeId);
        return true;
      }
      if (value.kind !== "edge") return false;
      const next = value.edge;
      const current = source.getEdge(next.id);
      if (!current) return false;
      const endpointsChanged =
        current.source !== next.source ||
        current.target !== next.target ||
        (current.sourceConnector ?? null) !== (next.sourceConnector ?? null) ||
        (current.targetConnector ?? null) !== (next.targetConnector ?? null);
      if (endpointsChanged) {
        // One write for both ends: reconnecting twice cannot express a swap.
        // The draft's other edge fields travel with it.
        source.setEdge(next);
        return true;
      }
      let changed = false;
      if (current.path !== next.path) {
        source.setEdgePath(next.id, next.path);
        changed = true;
      }
      if ((current.label ?? null) !== (next.label ?? null)) {
        source.setEdgeLabel(next.id, next.label ?? null);
        changed = true;
      }
      if (current.bidirectional !== next.bidirectional) {
        source.setEdgeBidirectional(next.id, next.bidirectional);
        changed = true;
      }
      return changed;
    }

    default:
      return false;
  }
}

/**
 * Applies a plan to the source workspace in one commit with `PUBLISH_ORIGIN`.
 *
 * A publish is all or nothing: a plan with conflicts or unsupported changes
 * returns 0 and writes nothing, because a partial publish would leave the draft
 * and the workspace disagreeing about the same edit. Field-level granularity is
 * preserved: unchanged values are compared before writing.
 *
 * The plan's captured values are authoritative; `draft` is only checked so a
 * draft can never be published onto itself.
 */
export function applyPublish(
  source: WorkspaceDocument,
  draft: WorkspaceDocument,
  plan: PublishPlan,
): number {
  if (source.doc === draft.doc) return 0;
  if (plan.conflicts.length > 0 || plan.unsupported.length > 0) return 0;

  const pending = plan.changes.filter((change) => plan.values[change.key] !== undefined);
  if (pending.length === 0) return 0;

  let applied = 0;
  source.batch(PUBLISH_ORIGIN, () => {
    for (const change of pending) {
      const value = plan.values[change.key];
      if (value && applyChange(source, change, value)) applied += 1;
    }
  });
  return applied;
}
