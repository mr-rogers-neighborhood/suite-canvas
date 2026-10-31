/**
 * A tutorial is a card and a tour is its timeline
 * (ADR-0054); the step
 * block, the card's own panel and the overlay are the three surfaces that read
 * it (ADR-0058).
 *
 * This module is the single source of truth for what a step *is*: the shape the
 * `tourStep` block stores in a card body, the parsing and repair every surface
 * shares, and the typed body mutations the Steps panel performs. A step is never
 * a second document — it lives in the card body as a `loro-prosemirror` node, so
 * the same Loro, undo and collaboration rules apply as to a paragraph.
 *
 * Two boundaries are deliberate:
 *
 * - **The anchor is a target and a viewport.** The target is what is pointed at;
 *   the viewport is what the reader sees when the target is gone, which is what
 *   keeps a rotten tour readable instead of broken (ADR-0054 §5).
 * - **Several targets, the first is primary.** "These three cards are a group"
 *   is one step. A consumer that needs one — a badge, a tombstone — reads
 *   `targets[0]` rather than searching for a match (ADR-0054 amendment).
 */

import { isContainer, LoroList, LoroMap } from "loro-crdt";
import { z } from "zod";
import type { Card, CardType, FieldDefinition, PropertyValue } from "./schema.js";
import { type Target, targetSchema } from "./target.js";

/** The Tiptap node name a step block stores in a card body. */
export const TOUR_STEP_NODE_NAME = "tourStep";

/** The `loro-prosemirror` keys a body node is made of. */
const NODE_NAME_KEY = "nodeName";
const ATTRIBUTES_KEY = "attributes";
const CHILDREN_KEY = "children";

/** How a reader leaves a step: the Next control, or the thing itself. */
export const tourStepAdvanceModes = ["next", "click"] as const;
export const tourStepAdvanceSchema = z.enum(tourStepAdvanceModes);

export type TourStepAdvance = (typeof tourStepAdvanceModes)[number];

/**
 * The camera a step asks for. Stored on the step instead of derived from the
 * target: a step may want the target small in a wide context, and the stored
 * frame is also what a dead target degrades to.
 */
export const tourStepViewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().positive(),
});

export type TourStepViewport = z.infer<typeof tourStepViewportSchema>;

/**
 * One step of a tour, as stored.
 *
 * `id` is the block's stable identity: the Steps panel addresses a step by it,
 * so reordering never edits the wrong row and two authors editing two captions
 * do not overwrite each other. It is authored once, when the block is created.
 */
export const tutorialStepSchema = z.object({
  id: z.string().min(1).optional(),
  targets: z.array(targetSchema).min(1),
  viewport: tourStepViewportSchema.optional(),
  caption: z.string().optional(),
  advance: tourStepAdvanceSchema.optional(),
});

export type TourStep = z.infer<typeof tutorialStepSchema>;

/**
 * The attributes the `tourStep` node declares, in declaration order. The editor
 * schema contract compares this list with the publish allowlist, so a new
 * attribute has to be added in both places.
 */
export const STEP_ATTRIBUTES = ["stepId", "targets", "viewport", "caption", "advance"] as const;

/** A step's attributes in the shape the Tiptap node holds them. */
export interface TourStepAttributes {
  stepId: string | null;
  targets: Target[];
  viewport: TourStepViewport | null;
  caption: string | null;
  advance: TourStepAdvance;
}

/** An empty step: what `/step` inserts before a target is picked. */
export function emptyTourStep(id: string | null = null): TourStepAttributes {
  return { stepId: id, targets: [], viewport: null, caption: null, advance: "next" };
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function optionalViewport(value: unknown): TourStepViewport | undefined {
  const parsed = tourStepViewportSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Valid targets, in the author's order, with duplicates dropped: a target names
 * one thing, and "this card twice" is a typo rather than a second highlight.
 */
function validTargets(value: unknown): Target[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const entry of value) {
    const parsed = targetSchema.safeParse(entry);
    if (!parsed.success) continue;
    const key = `${parsed.data.kind}:${parsed.data.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(parsed.data);
  }
  return targets;
}

/**
 * The stored shape, or null when it is not a usable step.
 *
 * Nulls are read as "not set" because that is how a Tiptap attribute the author
 * never touched arrives here; every other malformed field is a null result, not
 * a guess. Callers that want a repaired step use `normalizeStep`.
 */
export function parseStep(value: unknown): TourStep | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const id = trimmed(raw.stepId) ?? trimmed(raw.id);
  const caption = trimmed(raw.caption);
  const viewport = optionalViewport(raw.viewport);
  const advance = tourStepAdvanceSchema.safeParse(raw.advance);
  const parsed = tutorialStepSchema.safeParse({
    ...(id ? { id } : {}),
    targets: validTargets(raw.targets),
    ...(viewport ? { viewport } : {}),
    ...(caption ? { caption } : {}),
    ...(advance.success ? { advance: advance.data } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The repaired step, or null when nothing usable is left.
 *
 * A step written by an older build, a hand-edited body or a paste can carry a
 * target kind this build does not know; the repair drops it rather than making
 * the whole block unreadable, and an empty caption becomes absent so the
 * placeholder shows.
 */
export function normalizeStep(value: unknown): TourStep | null {
  return parseStep(value);
}

/** A step's attributes, ready to hand to the Tiptap node. */
export function stepAttributes(step: TourStep | null): TourStepAttributes {
  const empty = emptyTourStep();
  if (!step) return empty;
  return {
    stepId: step.id ?? null,
    targets: [...step.targets],
    viewport: step.viewport ?? null,
    caption: step.caption ?? null,
    advance: step.advance ?? "next",
  };
}

/** The target a single-target consumer reads: the first one, by convention. */
export function primaryTarget(step: TourStep): Target {
  const [first] = step.targets;
  if (!first) {
    // `tutorialStepSchema` enforces "at least one", so this is a type-system
    // formality rather than a state a caller can reach.
    throw new Error("A tour step always has at least one target");
  }
  return first;
}

/**
 * What the document still contains, for the one question every tour surface
 * asks: is this anchor still here?
 */
export interface TargetExistence {
  card: (id: string) => boolean;
  board: (id: string) => boolean;
  section: (id: string) => boolean;
  link: (id: string) => boolean;
}

/** True when the thing a target names is gone from the document. */
export function isDeadTarget(target: Target, exists: TargetExistence): boolean {
  switch (target.kind) {
    case "card":
      return !exists.card(target.id);
    case "board":
      return !exists.board(target.id);
    case "section":
      return !exists.section(target.id);
    case "link":
      return !exists.link(target.id);
    case "ui":
      // A region of the shell is not in the document, so it cannot be removed from it.
      // A step naming one is a handbook pointer, not a tour anchor.
      return false;
  }
}

/** True when any target of a step is gone; the step then reads as damaged. */
export function stepHasDeadTarget(step: TourStep, exists: TargetExistence): boolean {
  return step.targets.some((target) => isDeadTarget(target, exists));
}

/**
 * A card whose primary type is a tutorial. The name is the contract because a
 * type id is minted per workspace: "Tutorial" is what a reader sees, and a user
 * who renames their type says they no longer want the step panel.
 */
export const TUTORIAL_TYPE_NAME = "Tutorial";
export const TUTORIAL_TYPE_ID = "tutorial";
export const TOUR_READ_FIELD_NAME = "Tour read";

export function isTutorialType(type: { name: string } | undefined | null): boolean {
  return type?.name.trim().toLocaleLowerCase() === TUTORIAL_TYPE_NAME.toLocaleLowerCase();
}

export function isTutorialCard(
  card: Pick<Card, "primaryTypeId">,
  types: readonly Pick<CardType, "id" | "name">[],
): boolean {
  const type = types.find((candidate) => candidate.id === card.primaryTypeId);
  return type ? isTutorialType(type) : false;
}

// --------------------------------------------------------------- completion

/** The workspace operations a completion record needs. */
export interface TourProgressWorkspace {
  getCard: (cardId: string) => Card | undefined;
  getType: (typeId: string) => CardType | undefined;
  addField: (typeId: string, input: { name: string; kind: "date" }) => FieldDefinition;
  setProperty: (cardId: string, fieldId: string, value: PropertyValue | null) => void;
}

/** The field a tutorial's completion lives in, if its type already has one. */
export function tourReadField(type: CardType | undefined): FieldDefinition | undefined {
  return type?.fields.find((field) => field.name === TOUR_READ_FIELD_NAME);
}

/** `YYYY-MM-DD` in local time: the day the reader finished, not an instant. */
export function readDay(now = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Records that this reader finished the tour, as a workspace value on the
 * tutorial card (ADR-0054 §9): a collaborator sees "read", and the record
 * survives a reload and travels with the document. Never localStorage.
 *
 * The field is added to the card's primary type on first completion — additive
 * and once per type — because completion arrives while reading, and asking the
 * author to declare a field before their tour can record anything would make
 * "finished" a schema decision. Returns the field id written, or null when the
 * card is gone.
 */
export function markTourRead(
  workspace: TourProgressWorkspace,
  cardId: string,
  day = readDay(),
): string | null {
  const card = workspace.getCard(cardId);
  if (!card) return null;
  const type = workspace.getType(card.primaryTypeId) ?? workspace.getType(card.typeIds[0] ?? "");
  if (!type) return null;
  const field =
    tourReadField(type) ??
    workspace.addField(type.id, {
      name: TOUR_READ_FIELD_NAME,
      kind: "date",
    });
  workspace.setProperty(cardId, field.id, day);
  return field.id;
}

/** The day a tutorial was finished, or null when it has not been. */
export function tourReadDay(
  workspace: Pick<TourProgressWorkspace, "getType">,
  card: Pick<Card, "primaryTypeId" | "properties">,
): string | null {
  const type = workspace.getType(card.primaryTypeId);
  const field = tourReadField(type);
  if (!field) return null;
  const value = card.properties[field.id];
  return typeof value === "string" ? value : null;
}

// ------------------------------------------------------------------- body

/** The workspace operations a step block's body needs. */
export interface TourBodyWorkspace extends TourProgressWorkspace {
  peekContent: (cardId: string) => LoroMap | null;
  getContent: (cardId: string) => LoroMap;
  batch: <T>(origin: string, fn: () => T) => T;
}

/** One step block as the panel lists it. */
export interface StoredTourStep {
  /** Stable attribute id; null only for a block written before ids existed. */
  stepId: string | null;
  /** The stored step, or null while the block has no target yet. */
  step: TourStep | null;
}

const STEP_BODY_ORIGIN = "struct:tour-step";

/**
 * A `loro-prosemirror` node's children list. Its containers are plain, not
 * mergeable, so `ensureMergeableList` would throw on a body an editor wrote.
 */
function nodeChildren(node: LoroMap): LoroList {
  const existing = node.get(CHILDREN_KEY);
  return isChildren(existing) ? existing : node.getOrCreateContainer(CHILDREN_KEY, new LoroList());
}

function isChildren(value: unknown): value is LoroList {
  return isContainer(value) && value instanceof LoroList;
}

/** A node's attributes map, created the way `loro-prosemirror` creates it. */
function nodeAttributes(node: LoroMap): LoroMap {
  const existing = node.get(ATTRIBUTES_KEY);
  return isMapContainer(existing)
    ? existing
    : node.getOrCreateContainer(ATTRIBUTES_KEY, new LoroMap());
}

function isMapContainer(value: unknown): value is LoroMap {
  return isContainer(value) && value instanceof LoroMap;
}

/** Every direct child of a node that is a map, in document order. */
function childNodes(parent: LoroMap): LoroMap[] {
  const children = parent.get(CHILDREN_KEY);
  if (!isChildren(children)) return [];
  return children.toArray().filter(isMapContainer);
}

/**
 * The step blocks of one body container, in document order. Pure read: a panel
 * that already holds the container can list steps without the workspace, which
 * is how a surface decides a card *is* a tutorial from its body alone.
 */
export function tourStepsInContent(content: unknown): StoredTourStep[] {
  if (!isMapContainer(content)) return [];
  const steps: StoredTourStep[] = [];
  for (const node of childNodes(content)) {
    if (node.get(NODE_NAME_KEY) !== TOUR_STEP_NODE_NAME) continue;
    const raw = nodeAttributes(node).toJSON() as Record<string, unknown>;
    const step = parseStep(raw);
    const stepId = trimmed(raw.stepId);
    steps.push({ stepId: stepId ?? null, step });
  }
  return steps;
}

/** The step blocks of one card body, in document order. */
export function listTourSteps(
  workspace: Pick<TourBodyWorkspace, "peekContent">,
  cardId: string,
): StoredTourStep[] {
  return tourStepsInContent(workspace.peekContent(cardId));
}

/** The live steps a tour plays; a block without a target is not a stop. */
export function tourSteps(
  workspace: Pick<TourBodyWorkspace, "peekContent">,
  cardId: string,
): TourStep[] {
  const steps: TourStep[] = [];
  for (const stored of listTourSteps(workspace, cardId)) {
    if (stored.step) steps.push(stored.step);
  }
  return steps;
}

/** The Loro node holding one step, found by its stable id. */
function stepNode(content: LoroMap, stepId: string | null): LoroMap | null {
  for (const node of childNodes(content)) {
    if (node.get(NODE_NAME_KEY) !== TOUR_STEP_NODE_NAME) continue;
    const raw = nodeAttributes(node).toJSON() as Record<string, unknown>;
    if (trimmed(raw.stepId) === stepId) return node;
  }
  return null;
}

/** Appends an empty block and returns its id, or null when the card is gone. */
export function insertTourStep(
  workspace: TourBodyWorkspace,
  cardId: string,
  step: TourStep,
): boolean {
  if (!workspace.getCard(cardId)) return false;
  return workspace.batch(STEP_BODY_ORIGIN, () => {
    const content = workspace.getContent(cardId);
    if (content.get(NODE_NAME_KEY) == null) content.set(NODE_NAME_KEY, "doc");
    const children = nodeChildren(content);
    const node = children.insertContainer(children.length, new LoroMap());
    node.set(NODE_NAME_KEY, TOUR_STEP_NODE_NAME);
    const attributes = nodeAttributes(node);
    for (const [key, value] of Object.entries(stepAttributes(step))) {
      if (value !== null) attributes.set(key, value);
    }
    nodeChildren(node);
    return true;
  });
}

/** Writes the attributes a panel edit changed; a null value clears the key. */
export function updateTourStep(
  workspace: TourBodyWorkspace,
  cardId: string,
  stepId: string | null,
  patch: Partial<Omit<TourStepAttributes, "stepId">>,
): boolean {
  const content = workspace.peekContent(cardId);
  if (!content) return false;
  const node = stepNode(content, stepId);
  if (!node) return false;
  return workspace.batch(STEP_BODY_ORIGIN, () => {
    const attributes = nodeAttributes(node);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined) attributes.delete(key);
      else attributes.set(key, value);
    }
    return true;
  });
}

/** Drops one step block. The targets are other cards, so nothing else moves. */
export function removeTourStep(
  workspace: TourBodyWorkspace,
  cardId: string,
  stepId: string | null,
): boolean {
  const content = workspace.peekContent(cardId);
  if (!content) return false;
  const children = content.get(CHILDREN_KEY);
  if (!isChildren(children)) return false;
  const nodes = children.toArray();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!isMapContainer(node)) continue;
    if (node.get(NODE_NAME_KEY) !== TOUR_STEP_NODE_NAME) continue;
    const raw = nodeAttributes(node).toJSON() as Record<string, unknown>;
    if (trimmed(raw.stepId) !== stepId) continue;
    return workspace.batch(STEP_BODY_ORIGIN, () => {
      children.delete(index, 1);
      // A body keeps one block so the ProseMirror document stays valid.
      if (children.length === 0) {
        const paragraph = children.insertContainer(0, new LoroMap());
        paragraph.set(NODE_NAME_KEY, "paragraph");
        nodeAttributes(paragraph);
        nodeChildren(paragraph);
      }
      return true;
    });
  }
  return false;
}

/**
 * Moves a step one place earlier or later among the steps of the body.
 *
 * A body's children list is a plain `LoroList`, which cannot move an entry, so
 * the block is rewritten at its new index in a single commit. A step holds its
 * attributes and nothing else, so nothing is lost by it; two authors reordering
 * the same step at the same moment resolve to one of the two orders, which is
 * what a reorder means.
 */
export function moveTourStep(
  workspace: TourBodyWorkspace,
  cardId: string,
  stepId: string | null,
  direction: -1 | 1,
): boolean {
  const content = workspace.peekContent(cardId);
  if (!content) return false;
  const children = content.get(CHILDREN_KEY);
  if (!isChildren(children)) return false;
  const nodes = children.toArray();
  const positions: number[] = [];
  let from = -1;
  let moved: Record<string, unknown> | null = null;
  nodes.forEach((node, index) => {
    if (!isMapContainer(node)) return;
    if (node.get(NODE_NAME_KEY) !== TOUR_STEP_NODE_NAME) return;
    const raw = nodeAttributes(node).toJSON() as Record<string, unknown>;
    if (trimmed(raw.stepId) === stepId) {
      from = positions.length;
      moved = raw;
    }
    positions.push(index);
  });
  const to = from + direction;
  const fromIndex = from >= 0 ? positions[from] : undefined;
  const toIndex = to >= 0 ? positions[to] : undefined;
  if (!moved || fromIndex === undefined || toIndex === undefined) return false;
  const attributes = moved;
  return workspace.batch(STEP_BODY_ORIGIN, () => {
    children.delete(fromIndex, 1);
    // The deletion shifts everything after it down one, so the neighbour's
    // original index is exactly where the moved block belongs.
    const node = children.insertContainer(toIndex, new LoroMap());
    node.set(NODE_NAME_KEY, TOUR_STEP_NODE_NAME);
    const target = nodeAttributes(node);
    for (const [key, value] of Object.entries(attributes)) target.set(key, value);
    nodeChildren(node);
    return true;
  });
}
