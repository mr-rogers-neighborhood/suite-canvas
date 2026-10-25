/**
 * The card projection's lifecycle.
 *
 * A card on the desk is a *projection* of a canonical placement: the document
 * says where it is and what it says, and this hook derives the widgets from
 * that, one reconcile at a time. Nothing here writes the workspace — the
 * editing controller commits, and its `afterCommit` lands back here.
 *
 * The reconcile is coalesced to one pass per frame because a document change
 * can arrive from a peer, and a sync of a 5k workspace is not a keystroke cost.
 * It also redraws the links: a link is document data too, so one a peer drew
 * must appear without a reload and one they deleted must go.
 *
 * What a card *says* is assembled here and nowhere else (ADR-0043 §2): the
 * document is asked for the type's glyph, the title, the reference and tag
 * counts and the body, and `suiteCardFace` folds them into the one flow the
 * paper writes. The band is not this module's business — the face is banded by
 * the card's own on-screen width, which only the kind knows at draw time — so
 * the flow always carries the title row *and* the body and the kind truncates.
 */

import { boardWorldRect } from "@suite/graph";
import type { Entity } from "@vibecook/ice";
import { type RefObject, useEffect, useMemo, useRef } from "react";

import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../canvas/multiSelect";
import { typesById } from "../cards/cardTypes";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { type ReferenceCountLookup, referenceCounts } from "../hooks/useReferenceCounts";
import { useUiStore } from "../store/useUiStore";
import { workspaceStructureKey } from "./iceBoardTree";
import { type CanonicalPlacement, CardProjection } from "./iceCardProjection";
import { extentOf, type FitRect, fitCamera } from "./iceSurfaceCamera";
import { entityRectOf } from "./iceSurfaceShared";
import type { IceCommands, IceOwned, IceWiring } from "./iceSurfaceWiring";
import { type CardFaceSources, cardFaceFrom, publishCardFaces } from "./suiteCardFace";
import { cardFit } from "./suiteCardFit";
import { cardTypeForScale, scaleForExtent } from "./suiteCardScale";
import { type WhiteboardFace, whiteboardFace } from "./suiteWhiteboardFace";
import { useIceCameraPersist } from "./useIceCameraPersist";

export interface IceProjection {
  /** Bring the desk in line with the document: cards, links and the selection. */
  reconcile(): void;
  /** Fit the View's content: its cards and its sections, never the workspace. */
  fitView(): void;
}

/**
 * A face's view of the document for one reconcile pass: the type table, the
 * reference counts and the whiteboards' scenes, each resolved once rather than
 * once per card.
 */
type FacePass = CardFaceSources;

/**
 * The View's cards, derived from the document.
 *
 * The projection is rebuilt with the wiring (a new desk, a new seed), and the
 * handles below survive it: `reconcile` and `fitView` read whatever the last
 * run registered, so a keymap or a menu can hold them without re-rendering.
 */
export function useIceProjection(input: {
  readonly wiring: IceWiring;
  readonly snapshot: WorkspaceSnapshot;
  readonly commands: RefObject<IceCommands | null>;
  readonly owned: RefObject<IceOwned>;
}): IceProjection {
  const { wiring, snapshot, commands, owned } = input;
  useIceCameraPersist(wiring);
  /**
   * A drawing is not in the snapshot, so a whiteboard's face would wait for an
   * unrelated edit: `drawings` is a root map the document keeps, and the card
   * projection only hears about cards, edges and Boards. The document's own
   * callback is the invalidation — coalesced to one reconcile per frame, so a
   * peer's stroke and a keystroke cost the same pass.
   */
  useEffect(() => {
    const workspace = wiring.liveWorkspace;
    if (workspace === null) return;
    let handle = 0;
    const unsubscribe = workspace.doc.subscribe((batch) => {
      // Only a drawing edit: everything else already arrives through the
      // snapshot, and a second pass per keystroke is a second pass.
      if (!batch.events.some((event) => event.path[0] === "drawings")) return;
      if (handle !== 0) return;
      handle = requestAnimationFrame(() => {
        handle = 0;
        commands.current?.reconcile();
      });
    });
    return () => {
      unsubscribe();
      if (handle !== 0) cancelAnimationFrame(handle);
    };
  }, [wiring.liveWorkspace, commands]);
  // The effect below rebuilds only when its wiring changes, so the snapshot it
  // was created with would go stale on the very next keystroke. The face reads
  // the *latest* one through this ref: counts and type glyphs are snapshot data.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const reconcileRef = useRef<(() => void) | null>(null);
  const fitViewRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const { phase, seed, layerReady, workspaceMode, liveWorkspace, rootBoardId } = wiring;
    const { cameraApi, flyTo } = wiring;
    if (phase.kind !== "ready" || seed === null || layerReady === 0) return;
    if (!workspaceMode || liveWorkspace === null || rootBoardId === null) return;

    const { engine, core } = phase;
    const slots = seed.entitySlots;
    const rectOf = (entity: Entity) => entityRectOf(engine, core, entity);

    const removeEntities = (entities: readonly Entity[]) => {
      if (entities.length === 0) return;
      try {
        engine.ops.setSelection(entities);
        engine.ops.deleteSelection();
      } catch {
        // A refused removal is repaired by the next reconcile.
      }
    };

    // What a card says, as the one text flow its paper writes (ADR-0043 §2):
    // `glyph · title · ⇄n · ✎n · #n`, a blank line, then the body. The band is
    // the kind's: it truncates this flow to the title row at `compact` and to
    // nothing at `icon`, because only it knows the card's width on screen.
    const faceText = (cardId: string, pass: FacePass): string => cardFaceFrom(pass, cardId);

    /**
     * Everything the face needs of the document, resolved once per pass.
     *
     * The counts are the inspector's own figure (`referenceCounts`, memoised on
     * the snapshot's sections, so a pass that follows no document change reuses
     * the walk), and a whiteboard's scene is read once per pass — never per
     * frame, which is the half of ADR-0043 §3 the interim keeps.
     */
    const facePass = (): FacePass => {
      const latest = snapshotRef.current;
      const types = typesById(latest.types);
      let counts: ReferenceCountLookup | null = null;
      const drawings = new Map<string, WhiteboardFace>();
      return {
        workspace: liveWorkspace,
        types,
        referencesOf: (cardId) => {
          if (counts === null) counts = referenceCounts(latest);
          return counts(cardId);
        },
        drawingOf: (cardId) => {
          let face = drawings.get(cardId);
          if (face === undefined) {
            face = whiteboardFace(liveWorkspace.drawing(cardId)?.elements);
            drawings.set(cardId, face);
          }
          return face;
        },
      };
    };

    /** The View's live placements: trashed cards are not on the View. */
    const livePlacements = () =>
      liveWorkspace.listBoardPlacements(rootBoardId).filter((placement) => {
        const card = liveWorkspace.getCard(placement.cardId);
        // A trashed card keeps its placement; it is simply not on the View.
        return card !== undefined && !card.deletedAt;
      });

    /**
     * The View's live placements, in the shape the projection reconciles: the
     * cards on the View's plane *and* the ones inside its Boards, in their own
     * Board's coordinates. `listBoardPlacements` flattens a View into plane coordinates,
     * which is what the fit wants; a card inside a Board is drawn in that
     * Board's frame, and ICE stores its box there, so a comparison against the
     * flattened coordinate would replace every nested card on every reconcile.
     */
    const canonicalPlacements = (): CanonicalPlacement[] => {
      const boards = liveWorkspace.listBoards();
      const pass = facePass();
      const placements = livePlacements().map((placement) => {
        // A flattened plane coordinate less the Board's own origin is exactly
        // the frame-local coordinate ICE stores for a child of that Board.
        const origin = boardWorldRect(boards, placement.boardId);
        return {
          boardId: placement.boardId,
          cardId: placement.cardId,
          x: placement.x - (origin?.x ?? 0),
          y: placement.y - (origin?.y ?? 0),
          text: faceText(placement.cardId, pass),
          ...(placement.width === undefined ? {} : { width: placement.width }),
          ...(placement.height === undefined ? {} : { height: placement.height }),
          ...(placement.typeScale === undefined ? {} : { typeScale: placement.typeScale }),
        };
      });
      // Publish what the faces say: the kind draws from here (so a boot that
      // spawned the cards first keeps its entity ids), and the dev snapshot
      // reads the same map for the lab (ADR-0043 §2).
      publishCardFaces(new Map(placements.map((entry) => [entry.cardId, entry.text ?? ""])));
      return placements;
    };

    /**
     * The frame a placement belongs to. A card inside a Board is spawned with
     * that Board's mat as its parent, so ICE measures it in the Board's frame —
     * and, just as important, a root card is spawned on the root frame even
     * while the camera is inside a Board (the default parent is the nav frame).
     */
    const parentFor = (boardId: string): Entity | undefined => {
      for (const [entity, mat] of seed.boardMats) {
        if (mat.boardId === boardId) return entity;
      }
      if (boardId !== rootBoardId) return undefined;
      try {
        return engine.world.getResource(core.BoardRoot)?.root;
      } catch {
        return undefined;
      }
    };

    /** Fit View frames the whole View; a Board's frame counts as content. */
    const contentBounds = (): FitRect | null => {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let seen = false;
      const include = (x: number, y: number, width: number, height: number): void => {
        if (![x, y, width, height].every((value) => Number.isFinite(value))) return;
        seen = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
      };
      for (const placement of livePlacements()) {
        include(
          placement.x,
          placement.y,
          extentOf(placement.width, DEFAULT_CARD_WIDTH),
          extentOf(placement.height, DEFAULT_CARD_HEIGHT),
        );
      }
      for (const section of liveWorkspace.listSections(rootBoardId)) {
        include(section.x, section.y, section.width, section.height);
      }
      if (!seen) return null;
      return {
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      };
    };

    const projection = new CardProjection<Entity>({
      spawn: (placement: CanonicalPlacement) => {
        // The rung is the card's own: a reflow resize stores one, and every
        // other card derives it from its extent. Same function either way, so a
        // freshly dropped card and a reflowed one cannot disagree.
        const parent = parentFor(placement.boardId);
        const entity = engine.ops.spawnWidget(cardTypeForScale(cardScaleOf(placement)), {
          x: placement.x,
          y: placement.y,
          ...(placement.width !== undefined && placement.height !== undefined
            ? { w: placement.width, h: placement.height }
            : {}),
          undoable: false,
          ...(parent === undefined ? {} : { parent }),
          props: {
            cardId: placement.cardId,
            boardId: placement.boardId,
            // The boot's copy of the words. The sheet draws the *published*
            // face (`cardFaceOf`), which is this flow — the prop is the
            // fallback for a card no projection owns, and the record's rung
            // carries the revision that says when the published flow moved.
            text: placement.text ?? "",
            seeds: "",
            title: "",
            body: "",
            paper: "card",
            pen: "card",
            seed: 0,
          },
        });
        slots.set(entity, {
          cardId: placement.cardId,
          boardId: placement.boardId,
          text: placement.text ?? "",
        });
        return entity;
      },
      remove: (entity) => {
        removeEntities([entity]);
        slots.delete(entity);
      },
      boxOf: (entity) => rectOf(entity),
      // Text and the type rung both need a replace rather than a move: a
      // resize that crosses a rung changes the *kind*, and a card cannot change
      // kind in place.
      // Text, rung and the Board a placement sits on: a card dropped into a
      // Board must come back with that Board in its props, or the face would
      // keep saying it lives where it used to.
      keyOf: (placement) =>
        `${placement.text ?? ""}\u001f${cardScaleOf(placement)}\u001f${placement.boardId}`,
    });

    // Adopt the cards the boot seeded, with the key a reconcile will compute.
    //
    // The seed spawns each card before this projection exists and writes *its
    // own* text into the card's props (`suiteProjection` composes `title`, a
    // blank line, the body). The face the desk draws is not that prop: the
    // projection publishes what a card says (`cardFaceFrom`, ADR-0043 §2) and
    // the kind reads it from there, so the entity the boot made is the entity
    // the reconcile wants — no id churn, and no replace of a card the presence
    // layer, the link gesture and the selection are already holding.
    const seededPlacements = new Map(
      canonicalPlacements().map((placement) => [placement.cardId, placement]),
    );
    const seedFaces = facePass();
    for (const [entity, slot] of seed.entitySlots) {
      const placement = seededPlacements.get(slot.cardId);
      const text = placement?.text ?? faceText(slot.cardId, seedFaces);
      projection.register(
        entity,
        slot.cardId,
        slot.boardId,
        placement === undefined
          ? text
          : `${text}\u001f${cardScaleOf(placement)}\u001f${slot.boardId}`,
      );
    }

    /**
     * The rung a card's writing is laid out at: the stored rung when a reflow
     * pinned one, otherwise what its box implies — and in either case the
     * writing has the last word, so a card is never drawn with text that runs
     * off it (`suiteCardFit.ts`).
     */
    function cardScaleOf(placement: CanonicalPlacement): number {
      const proposed = placement.typeScale ?? scaleForExtent(placement);
      // No size on the placement means the card's natural extent, which the fit
      // module resolves itself; a stored rung is a request, not a promise.
      const extent = {
        width: placement.width ?? DEFAULT_CARD_WIDTH,
        height: placement.height ?? DEFAULT_CARD_HEIGHT,
      };
      const fitted = cardFit(placement.text ?? "", extent).rung;
      return Math.min(proposed, fitted);
    }

    /** Re-apply the shell's selection after entities were spawned or removed. */
    const restoreSelection = (): void => {
      const selected = useUiStore
        .getState()
        .selectedNodeIds.map((cardId) => projection.entityOf(cardId))
        .filter((entity): entity is Entity => entity !== undefined);
      try {
        if (selected.length > 0) engine.ops.setSelection(selected);
      } catch {
        // A refused selection is cosmetic; the next click repairs it.
      }
    };

    /** The card faces: one widget per live placement. */
    const reconcileCards = () => {
      const report = projection.reconcile(canonicalPlacements(), {
        width: DEFAULT_CARD_WIDTH,
        height: DEFAULT_CARD_HEIGHT,
      });
      if (
        report.failures.length > 0 &&
        typeof console !== "undefined" &&
        typeof console.warn === "function"
      ) {
        console.warn("[ice] projection reconcile", report.failures);
      }
      // A replace makes a new entity, so a selection held across one would be
      // dropped. Re-derive it from the card ids: the projection is the only
      // place that knows which entity now stands for which card.
      if (report.spawned.length > 0 || report.moved.length > 0 || report.removed.length > 0) {
        restoreSelection();
      }
    };

    /**
     * A document change: re-derive what the desk draws from the new truth.
     * Cards and links both, because a link is document data too — one a peer
     * drew must appear here without a reload, and one they deleted must go.
     */
    const reconcile = () => {
      reconcileCards();
      const edges = owned.current.edges;
      if (edges !== undefined) {
        edges.sync((entity) => removeEntities([entity]));
        restoreSelection();
      }
    };

    /**
     * Fit the View's content. The View is the frame, so this frames its cards
     * and its sections — never the whole workspace, and never a fixed scale.
     */
    const fitView = (): void => {
      const viewport = cameraApi?.viewportOf() ?? null;
      if (viewport === null) return;
      const bounds = contentBounds();
      // An empty View has nothing to frame; the camera stays where it is.
      if (bounds === null) return;
      flyTo(fitCamera(bounds, viewport));
    };

    reconcileRef.current = reconcile;
    fitViewRef.current = fitView;
    // A rebuild replaces every entity the projection held, so a selection the
    // shell kept across it would be a set of dead ids. Re-derive it from the
    // card ids now that the new entities are registered; on a first seed this
    // is the same shell-driven selection the surface started with.
    restoreSelection();
    return () => {
      reconcileRef.current = null;
      fitViewRef.current = null;
    };
  }, [wiring, owned]);

  /**
   * The Board tree, and only the Board tree.
   *
   * A mat is a container: ICE compiles an inside frame for it when it spawns,
   * which is why cards converge through `reconcile` and Boards do not. The boot
   * records the structural key it seeded from; when the document's key differs,
   * the desk rebuilds its contents from the document — once, into the same
   * engine, with the reader's camera, selection and entered Board kept.
   *
   * The trigger is the Board/View half of the snapshot, so a card's move, a
   * resize, a keystroke or a link edit never even runs this effect: those are
   * the reconcile's own business, one pass per frame.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the Board/View arrays are the trigger; the key is read from the document.
  useEffect(() => {
    const { phase, seed, workspaceMode, liveWorkspace, rootBoardId } = wiring;
    if (phase.kind !== "ready" || seed === null || !workspaceMode) return;
    if (liveWorkspace === null || rootBoardId === null) return;
    const structure = workspaceStructureKey(liveWorkspace, rootBoardId);
    if (owned.current.structure === undefined || owned.current.structure === structure) return;
    owned.current.reseed?.();
  }, [wiring, snapshot.boards, snapshot.views, owned]);

  /**
   * Convergence: a document change this seat did not make — a peer's drag, a
   * link drawn elsewhere, an undo — has to reach the desk. The projection is
   * derived, so the answer is always "reconcile from the document", coalesced
   * to one pass per frame.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot arrays are the trigger; reconcile reads the document directly.
  useEffect(() => {
    if (wiring.phase.kind !== "ready" || wiring.seed === null || wiring.layerReady === 0) return;
    if (!wiring.workspaceMode || wiring.liveWorkspace === null) return;
    const handle = requestAnimationFrame(() => commands.current?.reconcile());
    return () => cancelAnimationFrame(handle);
  }, [
    snapshot.cards,
    snapshot.edges,
    snapshot.boards,
    wiring.phase,
    wiring.seed,
    wiring.layerReady,
    wiring.workspaceMode,
    wiring.liveWorkspace,
  ]);

  return useMemo(
    () => ({
      reconcile: () => reconcileRef.current?.(),
      fitView: () => fitViewRef.current?.(),
    }),
    [],
  );
}
