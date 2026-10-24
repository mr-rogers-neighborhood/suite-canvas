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
import { type Board, type Card, type Placement, WorkspaceDocument } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { seedExampleWorkspace } from "../demo/seedExample";

/** The ICE note kind the projection uses. */
export const SUITE_NOTE_TYPE = "desk.note";
/** The ICE mini-mat kind that stands for a child board. */
export const SUITE_MINIMAT_TYPE = "desk.minimat";
/** The custom Suite card kind, once the DOM overlay is wired. */
export const SUITE_CARD_TYPE = "suite.card";
/** Characters of card body kept in a note; the rest is inspection-only. */
export const SUITE_BODY_SNIPPET_LENGTH = 120;
/** Boards below the root that may open, i.e. the root is depth 0. */
export const SUITE_MAX_DEPTH = 2;

/** `desk.note`'s pen names, in ICE's order, cycled by note index. */
const NOTE_PENS = ["felt", "ball", "fountain", "red"] as const;
/** The vinyl a mini mat wears, by depth: depth 1 and below differ from the desk. */
const MINIMAT_VINYLS: Readonly<Record<number, string>> = { 1: "charcoal", 2: "slate" };

/**
 * `desk.minimat` sells three vinyls (`sage`, `slate`, `charcoal`) and its `vinyl`
 * prop is a closed `p.enum`, so a Board's palette colour cannot be passed
 * through: an unknown name fails the spawn and takes the Board's cards with it.
 * Each Board colour is therefore mapped onto the nearest vinyl, on purpose —
 * green is the desk's own green mat, cool hues the blue-grey slate, warm ones the
 * green-black charcoal. A Board's own colour coming back needs a `suite.board`
 * kind of our own (pinned in the plan), not another palette entry.
 */
export const MINIMAT_VINYL_NAMES = ["sage", "slate", "charcoal"] as const;
type MiniMatVinyl = (typeof MINIMAT_VINYL_NAMES)[number];
const MINIMAT_VINYL_BY_COLOR: Readonly<Record<NonNullable<Board["color"]>, MiniMatVinyl>> = {
  slate: "slate",
  blue: "slate",
  violet: "slate",
  green: "sage",
  amber: "charcoal",
  rose: "charcoal",
};

export type IceSuiteObjectKind = "note" | "card" | "minimat";
export type IceSuiteSkipKind = "portal" | "section";
export type IceSuiteSkipReason = "cycle" | "depth" | "section" | "missing";

/** How a non-portal card is projected: a native note, or the real Suite card kind. */
export type IceSuiteCardKind = "note" | "card";

export interface IceSuiteProjectionOptions {
  /** Defaults to `note`; `card` is used once the `suite.card` overlay is wired. */
  readonly cardKind?: IceSuiteCardKind;
}

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

/** A real Suite card overlay planned from one non-portal card. */
export interface IceSuiteCardObject {
  readonly kind: "card";
  readonly id: string;
  readonly type: typeof SUITE_CARD_TYPE;
  readonly boardId: string;
  readonly cardId: string;
  readonly title: string;
  /** Flattened excerpt for the GPU/fallback face; the DOM reads the real card. */
  readonly snippet: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  /** The mini mat this card sits inside; absent on the root board. */
  readonly parentId?: string;
  readonly props: Readonly<{
    cardId: string;
    boardId: string;
    /** The one text flow the paper writes (title, blank line, body). */
    text: string;
    seeds: string;
    title: string;
    body: string;
    paper: "card" | "yellow";
    pen: string;
    seed: number;
  }>;
}

/** A mini mat planned from one portal card. */
export interface IceSuiteMiniMat {
  readonly kind: "minimat";
  readonly id: string;
  readonly type: typeof SUITE_MINIMAT_TYPE;
  /** The board this mat opens. */
  readonly boardId: string;
  /** The Board that contains this one (its parent frame). */
  readonly parentBoardId: string;
  /** A Board is a container, not a card: there is no portal card to name. */
  readonly portalCardId: null;
  /** The Board's own name. */
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

export type IceSuiteObject = IceSuiteNote | IceSuiteCardObject | IceSuiteMiniMat;

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
  readonly kind: IceSuiteCardKind;
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

function placementSize(placement: Placement): { width?: number; height?: number } {
  return placement.width !== undefined && placement.height !== undefined
    ? { width: placement.width, height: placement.height }
    : {};
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
    ...placementSize(placement),
    ...(parent === undefined ? {} : { parentId: parent.objectId }),
    props: {
      text: snippet.length === 0 ? title : `${title}\n\n${snippet}`,
      pen: NOTE_PENS[index % NOTE_PENS.length] ?? "felt",
      // The seed is cosmetic (handwriting wobble), so it only has to be stable.
      seed: 1000 + index,
    },
  };
}

function suiteCardFrom(
  workspace: WorkspaceDocument,
  placement: Placement,
  card: Card,
  boardId: string,
  parent: ParentMat | undefined,
  index: number,
): IceSuiteCardObject {
  const title = workspace.displayTitle(card.id);
  const snippet = snippetOf(workspace.cardText(card.id));
  return {
    kind: "card",
    id: objectId(parent, "card", card.id),
    type: SUITE_CARD_TYPE,
    boardId,
    cardId: card.id,
    title,
    snippet,
    x: placement.x,
    y: placement.y,
    ...placementSize(placement),
    ...(parent === undefined ? {} : { parentId: parent.objectId }),
    props: {
      cardId: card.id,
      boardId,
      // The paper writes this: title, blank line, body.
      text: snippet.length === 0 ? title : `${title}\n\n${snippet}`,
      seeds: "",
      title,
      body: snippet,
      paper: "card",
      pen: "card",
      seed: 2000 + index,
    },
  };
}

/**
 * A Board is a container now (ADR-0039): its mat is spawned from the Board's own
 * rect, not from a card that pointed at it. The rect is given in the parent's
 * frame, which is exactly what a frame-local child needs.
 */
function minimatFrom(
  board: Board,
  parentBoardId: string,
  parent: ParentMat | undefined,
  depth: number,
): IceSuiteMiniMat {
  return {
    kind: "minimat",
    id: objectId(parent, "minimat", board.id),
    type: SUITE_MINIMAT_TYPE,
    boardId: board.id,
    parentBoardId,
    portalCardId: null,
    title: board.name.length > 0 ? board.name : "Board",
    depth,
    x: board.rect.x,
    y: board.rect.y,
    width: board.rect.width,
    height: board.rect.height,
    ...(parent === undefined ? {} : { parentId: parent.objectId }),
    props: {
      name: board.name.length > 0 ? board.name : "Board",
      vinyl:
        (board.color === undefined ? undefined : MINIMAT_VINYL_BY_COLOR[board.color]) ??
        MINIMAT_VINYLS[depth] ??
        "slate",
    },
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
  options: IceSuiteProjectionOptions = {},
): IceSuiteSeed {
  const root = workspace.getView(rootBoardId);
  const objects: IceSuiteObject[] = [];
  const boards: IceSuiteBoard[] = [];
  const cards: IceSuiteCard[] = [];
  const skipped: IceSuiteSkip[] = [];
  const cardKind: IceSuiteCardKind = options.cardKind ?? "note";
  let noteIndex = 0;

  /**
   * Walk one Board: its cards, then its child Boards as nested mats.
   *
   * A card's placement is frame-local to the Board that owns it, and a child
   * Board's rect is frame-local to its parent — so the projection hands ICE
   * exactly the coordinates the document stores, and ICE does the nesting.
   */
  const visit = (
    boardId: string,
    path: readonly string[],
    parent: ParentMat | undefined,
    depth: number,
  ): void => {
    const board = workspace.getBoard(boardId);
    const view = board === undefined ? workspace.getView(boardId) : undefined;
    if (board === undefined && view === undefined) {
      skipped.push({
        kind: "portal",
        id: boardId,
        boardId,
        reason: "missing",
        detail: `Board "${boardId}" is not in the workspace.`,
      });
      return;
    }
    const name = board?.name ?? view?.name ?? boardId;

    boards.push({
      id: boardId,
      name,
      depth,
      matId: parent?.objectId ?? null,
      portalCardId: null,
    });

    // `listBoardPlacements` flattens a View's whole tree into plane coordinates;
    // the walk spawns the tree itself, so only the cards this frame owns are
    // taken here. A Board answers with its own placements already.
    for (const placement of workspace
      .listBoardPlacements(boardId)
      .filter((entry) => entry.boardId === boardId)) {
      const card = workspace.getCard(placement.cardId);
      if (card === undefined) continue;
      if (cardKind === "card") {
        const image = suiteCardFrom(workspace, placement, card, boardId, parent, noteIndex);
        objects.push(image);
        cards.push({ cardId: card.id, objectId: image.id, boardId, kind: "card" });
      } else {
        const note = noteFrom(workspace, placement, card, boardId, parent, noteIndex);
        objects.push(note);
        cards.push({ cardId: card.id, objectId: note.id, boardId, kind: "note" });
      }
      noteIndex += 1;
    }

    for (const child of workspace.listBoardChildren(boardId)) {
      if (path.includes(child.id)) {
        skipped.push({
          kind: "portal",
          id: child.id,
          boardId,
          reason: "cycle",
          detail: `Board "${child.name}" nests a board already on the path (${path.join(" → ")}).`,
        });
        continue;
      }
      if (depth + 1 > SUITE_MAX_DEPTH) {
        skipped.push({
          kind: "portal",
          id: child.id,
          boardId,
          reason: "depth",
          detail: `Board "${child.name}" would sit at depth ${depth + 1}; the projection stops at ${SUITE_MAX_DEPTH}.`,
        });
        continue;
      }
      const mat = minimatFrom(child, boardId, parent, depth + 1);
      objects.push(mat);
      visit(child.id, [...path, child.id], { objectId: mat.id }, depth + 1);
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
      if ((object.kind === "note" || object.kind === "card") && !cards.has(object.cardId)) {
        cards.set(object.cardId, entity);
      }
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
