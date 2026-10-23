/**
 * A one-way, read-only projection of the Suite demo graph into ICE.
 *
 * The projection is the first parity step between the two engines, and it is
 * deliberately the smallest honest one: the existing `seedExampleWorkspace`
 * graph (three boards, fourteen cards, four portals, four sections) is built in
 * a throwaway in-memory `LoroDoc`, read through the public `WorkspaceDocument`
 * API, and translated into plain spawn plans for ICE's native note
 * (`desk.note`) and mini-mat (`desk.minimat`) kinds.
 *
 * There is no reverse direction. Nothing here is written back to the graph, no
 * document is persisted, and no Suite id is minted anywhere: the result is a
 * list of `IceSuiteObject`s plus the canonical id ↔ object id maps a caller can
 * pair with the entities ICE returns from `spawnWidget`.
 *
 * Mapping rules:
 * - A board is the desk itself at depth 0; every portal card to a child board
 *   becomes a mini mat at the card's placement, labelled with the child board's
 *   name.
 * - A non-portal card becomes a note at its placement. Its title is
 *   `displayTitle` and its body is a flattened `cardText` snippet.
 * - A child board's cards keep their placement coordinates: they are spawned as
 *   children of the mini mat, so ICE reads them frame-local and fits the mat's
 *   inside view to their bounds. No scaling is invented.
 * - A board already on the current path is a cycle; a portal deeper than
 *   `SUITE_MAX_DEPTH` is over budget. Both are recorded as skipped, never
 *   followed.
 * - Sections have no ICE kind. They are recorded as skipped; the mini mat's
 *   label carries the board name instead.
 *
 * Everything (ordering, ids, coordinates, pen/vinyl/seed choices) is derived
 * from the graph alone, so two builds of the same seed produce identical plans.
 */
import {
  type Board,
  type Card,
  type Placement,
  PORTAL_BOARD_FIELD_ID,
  PORTAL_TYPE_ID,
  WorkspaceDocument,
} from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { seedExampleWorkspace } from "../demo/seedExample";

/** The ICE note kind the projection uses. */
export const SUITE_NOTE_TYPE = "desk.note";
/** The ICE mini-mat kind that stands for a child board. */
export const SUITE_MINIMAT_TYPE = "desk.minimat";
/** Characters of card body kept in a note; the rest is inspection-only. */
export const SUITE_BODY_SNIPPET_LENGTH = 120;
/** Boards below the root that may open, i.e. the root is depth 0. */
export const SUITE_MAX_DEPTH = 2;

/** `desk.note`'s pen names, in ICE's order, cycled by note index. */
const NOTE_PENS = ["felt", "ball", "fountain", "red"] as const;
/** The vinyl a mini mat wears, by depth: depth 1 and below differ from the desk. */
const MINIMAT_VINYLS: Readonly<Record<number, string>> = { 1: "charcoal", 2: "slate" };
/** A portal without a stored size is the seed's own portal size (see `demo/seedExample`). */
const DEFAULT_MINIMAT_SIZE = { width: 288, height: 256 } as const;

export type IceSuiteObjectKind = "note" | "minimat";
export type IceSuiteSkipKind = "portal" | "section";
export type IceSuiteSkipReason = "cycle" | "depth" | "section" | "missing";

/** A note planned from one non-portal card. */
export interface IceSuiteNote {
  readonly kind: "note";
  readonly id: string;
  readonly type: typeof SUITE_NOTE_TYPE;
  /** The board whose placement produced this note. */
  readonly boardId: string;
  readonly cardId: string;
  /** `displayTitle(cardId)`. */
  readonly title: string;
  /** Flattened `cardText(cardId)` excerpt; empty when the card has no body. */
  readonly snippet: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  /** The mini mat this note sits inside; absent on the root board. */
  readonly parentId?: string;
  readonly props: Readonly<{ text: string; pen: string; seed: number }>;
}

/** A mini mat planned from one portal card. */
export interface IceSuiteMiniMat {
  readonly kind: "minimat";
  readonly id: string;
  readonly type: typeof SUITE_MINIMAT_TYPE;
  /** The board this mat opens. */
  readonly boardId: string;
  /** The board whose portal card placed this mat. */
  readonly parentBoardId: string;
  readonly portalCardId: string;
  /** The portal card's own `displayTitle`. */
  readonly title: string;
  /** Board depth below the root: a root portal is 1. */
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The mini mat this mat sits inside; absent on the root board. */
  readonly parentId?: string;
  readonly props: Readonly<{ name: string; vinyl: string }>;
}

export type IceSuiteObject = IceSuiteNote | IceSuiteMiniMat;

/** One board the projection walked, root first. */
export interface IceSuiteBoard {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  /** The mini mat that opens this board; `null` for the root (the desk itself). */
  readonly matId: string | null;
  readonly portalCardId: string | null;
}

/** One canonical card id ↔ projected object id pair; a card can project twice. */
export interface IceSuiteCard {
  readonly cardId: string;
  readonly objectId: string;
  readonly boardId: string;
  readonly kind: "note";
}

/** Something the projection refused to invent an ICE object for. */
export interface IceSuiteSkip {
  readonly kind: IceSuiteSkipKind;
  readonly id: string;
  readonly boardId: string;
  readonly reason: IceSuiteSkipReason;
  readonly detail: string;
}

/** The deterministic, side-effect-free plan handed to the ICE spawner. */
export interface IceSuiteSeed {
  readonly seedLabel: string;
  readonly rootBoardId: string;
  readonly objects: readonly IceSuiteObject[];
  readonly boards: readonly IceSuiteBoard[];
  readonly cards: readonly IceSuiteCard[];
  readonly skipped: readonly IceSuiteSkip[];
}

/** The slice of ICE's `SpawnWidgetOpts` the projection fills. */
export interface IceSuiteSpawnOptions<TEntity> {
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly h?: number;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly parent?: TEntity;
  readonly undoable?: boolean;
}

/**
 * The two doors the spawner needs from the engine. Kept structural so a test
 * can pass a plain recorder and the module never imports ICE at runtime.
 */
export interface IceSuiteSpawner<TEntity> {
  spawn(type: string, opts: IceSuiteSpawnOptions<TEntity>): TEntity;
  /** Advance the projection: register the root frame, compile a mat's inside. */
  project(): void;
}

export interface IceSuiteSpawnReport<TEntity> {
  readonly seeded: number;
  readonly kinds: readonly string[];
  readonly failures: readonly string[];
  /** Object id → entity, in spawn order. */
  readonly objects: ReadonlyMap<string, TEntity>;
  /** Canonical card id → entity; the first projection of a repeated card wins. */
  readonly cards: ReadonlyMap<string, TEntity>;
  /** Board id → the mini mat entity that opens it. */
  readonly boards: ReadonlyMap<string, TEntity>;
}

interface ParentMat {
  readonly objectId: string;
  readonly portalCardId: string;
}

function objectId(parent: ParentMat | undefined, kind: IceSuiteObjectKind, id: string): string {
  const own = `${kind}:${id}`;
  return parent === undefined ? own : `${parent.objectId}/${own}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return String(error);
}

/** A note-sized excerpt: whitespace flattened, cut once, ellipsised. */
export function snippetOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SUITE_BODY_SNIPPET_LENGTH) return flat;
  return `${flat.slice(0, SUITE_BODY_SNIPPET_LENGTH).trimEnd()}…`;
}

/** The board a portal card opens; `undefined` for a card that is not a portal. */
function portalTarget(card: Card): string | undefined {
  if (!card.typeIds.includes(PORTAL_TYPE_ID)) return undefined;
  const value = card.properties[PORTAL_BOARD_FIELD_ID];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function noteFrom(
  workspace: WorkspaceDocument,
  placement: Placement,
  card: Card,
  boardId: string,
  parent: ParentMat | undefined,
  index: number,
): IceSuiteNote {
  const title = workspace.displayTitle(card.id);
  const snippet = snippetOf(workspace.cardText(card.id));
  const size =
    placement.width !== undefined && placement.height !== undefined
      ? { width: placement.width, height: placement.height }
      : {};
  return {
    kind: "note",
    id: objectId(parent, "note", card.id),
    type: SUITE_NOTE_TYPE,
    boardId,
    cardId: card.id,
    title,
    snippet,
    x: placement.x,
    y: placement.y,
    ...size,
    ...(parent === undefined ? {} : { parentId: parent.objectId }),
    props: {
      text: snippet.length === 0 ? title : `${title}\n\n${snippet}`,
      pen: NOTE_PENS[index % NOTE_PENS.length] ?? "felt",
      // The seed is cosmetic (handwriting wobble), so it only has to be stable.
      seed: 1000 + index,
    },
  };
}

function minimatFrom(
  placement: Placement,
  card: Card,
  board: Board,
  parentBoardId: string,
  parent: ParentMat | undefined,
  depth: number,
  title: string,
): IceSuiteMiniMat {
  return {
    kind: "minimat",
    id: objectId(parent, "minimat", card.id),
    type: SUITE_MINIMAT_TYPE,
    boardId: board.id,
    parentBoardId,
    portalCardId: card.id,
    title,
    depth,
    x: placement.x,
    y: placement.y,
    width: placement.width ?? DEFAULT_MINIMAT_SIZE.width,
    height: placement.height ?? DEFAULT_MINIMAT_SIZE.height,
    ...(parent === undefined ? {} : { parentId: parent.objectId }),
    props: { name: board.name, vinyl: MINIMAT_VINYLS[depth] ?? "slate" },
  };
}

/**
 * Translates an already-seeded workspace into ICE spawn plans.
 *
 * Read-only: it calls the listing/reading API and nothing that writes. The
 * caller owns the workspace (and, for the demo, the throwaway document).
 */
export function projectWorkspaceToIce(
  workspace: WorkspaceDocument,
  rootBoardId: string,
): IceSuiteSeed {
  const root = workspace.getBoard(rootBoardId);
  const objects: IceSuiteObject[] = [];
  const boards: IceSuiteBoard[] = [];
  const cards: IceSuiteCard[] = [];
  const skipped: IceSuiteSkip[] = [];
  let noteIndex = 0;

  const visit = (
    boardId: string,
    path: readonly string[],
    parent: ParentMat | undefined,
    depth: number,
  ): void => {
    const board = workspace.getBoard(boardId);
    if (board === undefined) {
      skipped.push({
        kind: "portal",
        id: boardId,
        boardId,
        reason: "missing",
        detail: `Board "${boardId}" is not in the workspace.`,
      });
      return;
    }

    boards.push({
      id: board.id,
      name: board.name,
      depth,
      matId: parent?.objectId ?? null,
      portalCardId: parent?.portalCardId ?? null,
    });

    // Sections are geometry, not ownership, and ICE has no section kind: the
    // mat's name is the only label the projection can honestly carry.
    for (const section of workspace.listSections(boardId)) {
      skipped.push({
        kind: "section",
        id: section.id,
        boardId,
        reason: "section",
        detail: `Section "${section.title}" has no ICE equivalent; the mini mat is labelled with the board name.`,
      });
    }

    for (const placement of workspace.listBoardPlacements(boardId)) {
      const card = workspace.getCard(placement.cardId);
      if (card === undefined) continue;
      const targetBoardId = portalTarget(card);
      const title = workspace.displayTitle(card.id);

      if (targetBoardId === undefined) {
        const note = noteFrom(workspace, placement, card, boardId, parent, noteIndex);
        objects.push(note);
        cards.push({ cardId: card.id, objectId: note.id, boardId, kind: "note" });
        noteIndex += 1;
        continue;
      }

      if (path.includes(targetBoardId)) {
        skipped.push({
          kind: "portal",
          id: card.id,
          boardId,
          reason: "cycle",
          detail: `Portal "${title}" reopens a board already on the path (${path.join(" → ")}).`,
        });
        continue;
      }

      if (depth + 1 > SUITE_MAX_DEPTH) {
        skipped.push({
          kind: "portal",
          id: card.id,
          boardId,
          reason: "depth",
          detail: `Portal "${title}" would open board depth ${depth + 1}; the projection stops at ${SUITE_MAX_DEPTH}.`,
        });
        continue;
      }

      const target = workspace.getBoard(targetBoardId);
      if (target === undefined) {
        skipped.push({
          kind: "portal",
          id: card.id,
          boardId,
          reason: "missing",
          detail: `Portal "${title}" opens "${targetBoardId}", which is not in the workspace.`,
        });
        continue;
      }

      const mat = minimatFrom(placement, card, target, boardId, parent, depth + 1, title);
      objects.push(mat);
      visit(
        target.id,
        [...path, target.id],
        { objectId: mat.id, portalCardId: card.id },
        depth + 1,
      );
    }
  };

  visit(rootBoardId, [rootBoardId], undefined, 0);

  return {
    seedLabel: `${root?.name ?? "Workspace"} example`,
    rootBoardId,
    objects,
    boards,
    cards,
    skipped,
  };
}

/**
 * Builds the demo workspace in a throwaway in-memory document and projects it.
 * Nothing is persisted and the document is never handed out.
 */
export function buildSuiteSeed(): IceSuiteSeed {
  const workspace = new WorkspaceDocument(new LoroDoc());
  workspace.ensureDefaultTypes();
  const summary = seedExampleWorkspace(workspace);
  return projectWorkspaceToIce(workspace, summary.rootBoardId);
}

/**
 * Spawns a plan through an engine. Parents are spawned before their children
 * and `project()` runs before the first object and after every mini mat, which
 * is the lifecycle the desk would otherwise drive.
 */
export function spawnIceSuite<TEntity>(
  seed: IceSuiteSeed,
  spawner: IceSuiteSpawner<TEntity>,
): IceSuiteSpawnReport<TEntity> {
  const objects = new Map<string, TEntity>();
  const cards = new Map<string, TEntity>();
  const boards = new Map<string, TEntity>();
  const kinds: string[] = [];
  const failures: string[] = [];
  let seeded = 0;

  const project = (): void => {
    try {
      spawner.project();
    } catch (error) {
      failures.push(`projection: ${describeError(error)}`);
    }
  };

  project();

  for (const object of seed.objects) {
    const parent = object.parentId === undefined ? undefined : objects.get(object.parentId);
    if (object.parentId !== undefined && parent === undefined) {
      failures.push(`${object.id} (${object.type}): skipped — its mini mat did not spawn.`);
      continue;
    }

    const opts: IceSuiteSpawnOptions<TEntity> = {
      x: object.x,
      y: object.y,
      props: object.props,
      undoable: false,
      ...(object.width !== undefined && object.height !== undefined
        ? { w: object.width, h: object.height }
        : {}),
      ...(parent === undefined ? {} : { parent }),
    };

    try {
      const entity = spawner.spawn(object.type, opts);
      seeded += 1;
      kinds.push(object.type);
      objects.set(object.id, entity);
      if (object.kind === "note" && !cards.has(object.cardId)) cards.set(object.cardId, entity);
      if (object.kind === "minimat") {
        if (!boards.has(object.boardId)) boards.set(object.boardId, entity);
        // A mat's inside frame is compiled before anything is put in it.
        project();
      }
    } catch (error) {
      failures.push(`${object.id} (${object.type}): ${describeError(error)}`);
    }
  }

  return { seeded, kinds, failures, objects, cards, boards };
}
