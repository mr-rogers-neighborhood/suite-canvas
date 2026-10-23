import type { Connector } from "@suite/graph";
import {
  beginDrag,
  type DragSession,
  dragDelta,
  hitTest,
  hitTestRect,
  marqueeRect,
  type Point,
  type PortalInstance,
  type Rect,
  type ResizeHandle,
  rectEquals,
  rectFromPoints,
  resizeFromHandle,
  resizeMove,
  type Scene,
  type SceneHitTarget,
  screenToPage,
  type Transform,
  transformRect,
} from "@suite/scene";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useUiStore } from "../store/useUiStore";
import {
  connectorHandleAt,
  connectorHandleSlop,
  connectorIdForSide,
  nearestConnectorSide,
  resizeHandleAt,
  resizeHandleCursor,
  resizeHandlePageSize,
  resizeHandleSlop,
  resolveConnectorHandles,
  resolveResizeTarget,
  resolveSectionResizeTarget,
  type SceneConnectorHandle,
  type SceneResizeTarget,
} from "./sceneSelection";

/** Screen-space movement before a press counts as a drag. */
export const SCENE_DRAG_THRESHOLD = 3;

/** Page-space movement below this commits nothing. */
const COMMIT_EPSILON = 0.01;

/** Presence pointer samples, matching the flow surface's hover cadence. */
const POINTER_THROTTLE_MS = 60;
/** Presence gesture samples; the flow surface streams drags at the same rate. */
const GESTURE_THROTTLE_MS = 40;

/** Graph minimum for a section, so the live box matches the committed one. */
const SECTION_MIN_SIZE = { width: 80, height: 60 } as const;

/**
 * The writes this surface owns; `WorkspaceDocument` satisfies it as-is.
 * Sections carry their members, so a section drag stays one document commit.
 */
export interface SceneInteractionWorkspace {
  movePlacements(boardId: string, moves: { cardId: string; x: number; y: number }[]): void;
  updatePlacementGeometry(
    boardId: string,
    cardId: string,
    geometry: { x: number; y: number; width: number; height: number },
  ): void;
  moveSectionsBatch(input: {
    sections: { id: string; x: number; y: number; width?: number; height?: number }[];
    placements?: { boardId: string; cardId: string; x: number; y: number }[];
  }): void;
  updateSectionGeometry(
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ): void;
}

/** Start geometry of a section drag, derived from stored graph data. */
export interface SceneSectionMovePlan {
  readonly sections: readonly { readonly id: string; readonly x: number; readonly y: number }[];
  readonly placements: readonly {
    readonly boardId: string;
    readonly cardId: string;
    readonly x: number;
    readonly y: number;
  }[];
}

/** A connector drop the surface wants written as one edge. */
export interface SceneConnectorCreate {
  readonly boardId: string;
  readonly sourceCardId: string;
  readonly targetCardId: string;
  readonly sourceConnectorId: string | null;
  readonly targetConnectorId: string | null;
}

export interface UseSceneInteractionOptions {
  /** The projected scene; its `camera` is the one used for every pointer mapping. */
  readonly scene: Scene;
  /** Layout edits are gated here; a viewer still selects and marquees. */
  readonly canEditLayout: boolean;
  readonly workspace: SceneInteractionWorkspace;
  /** Enter a portal by focusing its child board, never by switching boards. */
  readonly onFocusPortal?: ((portal: PortalInstance) => void) | undefined;
  /**
   * Section membership and start boxes, read from the same stored geometry the
   * graph uses. Without it a section is still selectable, just not draggable.
   */
  readonly planSectionMove?: ((sectionId: string) => SceneSectionMovePlan | null) | undefined;
  /** Canonical connectors of a card, so a new edge anchors where it was drawn. */
  readonly connectorsFor?: ((cardId: string) => readonly Connector[]) | undefined;
  /** Present only when the session may create content; enables connector drags. */
  readonly createConnector?: ((input: SceneConnectorCreate) => void) | undefined;
}

interface GestureBase {
  readonly pointerId: number;
  readonly startScreen: Point;
  moved: boolean;
}

interface CardGesture extends GestureBase {
  readonly kind: "card";
  readonly hit: SceneHitTarget;
  readonly session: DragSession | null;
  /** Page-space boxes captured at press, used to paint the drag override. */
  readonly startRects: ReadonlyMap<string, Rect>;
}

interface SectionGesture extends GestureBase {
  readonly kind: "section";
  readonly sectionId: string;
  readonly startPage: Point;
  /** Null for a viewer or a section the graph does not know: select only. */
  readonly plan: SceneSectionMovePlan | null;
  readonly transform: Transform;
  readonly startRects: ReadonlyMap<string, Rect>;
}

/** A selected-edge press: the click already did its work on pointer down. */
interface EdgeGesture extends GestureBase {
  readonly kind: "edge";
}

interface ConnectorGesture extends GestureBase {
  readonly kind: "connector";
  readonly handle: SceneConnectorHandle;
  readonly boardId: string;
  readonly cardId: string;
}

interface MarqueeGesture extends GestureBase {
  readonly kind: "marquee";
  readonly startPage: Point;
  /** Selection restored on top of the marquee (shift). */
  readonly base: readonly string[];
}

interface ResizeGesture extends GestureBase {
  readonly kind: "resize";
  readonly target: SceneResizeTarget;
  readonly handle: ResizeHandle;
  readonly startLocal: Rect;
}

type SceneGesture =
  | CardGesture
  | SectionGesture
  | EdgeGesture
  | ConnectorGesture
  | MarqueeGesture
  | ResizeGesture;

export interface SceneInteractionHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export interface SceneInteraction {
  /** Canonical card ids; the shell and the inspector read the same list. */
  readonly selectedIds: readonly string[];
  /** Canonical section id selected on the surface, if any. */
  readonly selectedSectionId: string | null;
  /** Canonical edge ids selected on the surface. */
  readonly selectedEdgeIds: readonly string[];
  /** Live page-space boxes keyed by instance key; never canonical state. */
  readonly overrides: ReadonlyMap<string, Rect>;
  readonly marquee: Rect | null;
  /** Side-midpoint handles of a single selected card, in page space. */
  readonly connectorHandles: readonly SceneConnectorHandle[];
  /** Live connector line while a handle is dragged. */
  readonly connectorDrag: { readonly from: Point; readonly to: Point } | null;
  readonly handlers: SceneInteractionHandlers;
}

function screenPointOf(element: Element, event: { clientX: number; clientY: number }): Point {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function capturePointer(element: Element, pointerId: number): void {
  const target = element as Element & {
    setPointerCapture?: (id: number) => void;
  };
  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    // A pointer that already ended cannot be captured; the gesture still works.
  }
}

function releasePointer(element: Element, pointerId: number): void {
  const target = element as Element & {
    releasePointerCapture?: (id: number) => void;
    hasPointerCapture?: (id: number) => boolean;
  };
  try {
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture?.(pointerId);
  } catch {
    // Releasing an uncaptured pointer is harmless.
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function unionIds(base: readonly string[], next: readonly string[]): string[] {
  const result = [...base];
  for (const id of next) if (!result.includes(id)) result.push(id);
  return result;
}

/** Every card instance whose canonical id is selected, portals included. */
function instanceKeysFor(scene: Scene, ids: ReadonlySet<string>): string[] {
  const keys: string[] = [];
  for (const card of scene.cards) {
    if (ids.has(card.cardId)) keys.push(card.key);
  }
  return keys;
}

function pageRectsFor(session: DragSession): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const item of session.items) {
    rects.set(item.instanceKey, transformRect(item.transform, item.startLocal));
  }
  return rects;
}

/**
 * Page boxes of everything a section drag moves: the section, every section
 * contained by it and every member placement, portal frames included.
 */
function sectionStartRects(scene: Scene, plan: SceneSectionMovePlan): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  const sectionIds = new Set(plan.sections.map((entry) => entry.id));
  for (const section of scene.sections) {
    if (sectionIds.has(section.sectionId)) rects.set(section.key, section.rect);
  }
  const placementKeys = new Set(plan.placements.map((entry) => `${entry.boardId}:${entry.cardId}`));
  for (const card of scene.cards) {
    if (placementKeys.has(`${card.boardId}:${card.cardId}`)) rects.set(card.key, card.rect);
  }
  for (const portal of scene.portals) {
    if (placementKeys.has(`${portal.boardId}:${portal.cardId}`)) {
      rects.set(portal.key, portal.frame);
    }
  }
  return rects;
}

/** Canonical ids the marquee touched; sections and edges belong to other owners. */
function marqueeCardIds(scene: Scene, screenStart: Point, screenEnd: Point): string[] {
  const selection = hitTestRect(scene, scene.camera, rectFromPoints(screenStart, screenEnd));
  const ids: string[] = [];
  for (const ref of selection.cards) {
    if (ref.cardId && !ids.includes(ref.cardId)) ids.push(ref.cardId);
  }
  for (const ref of selection.portals) {
    if (ref.cardId && !ids.includes(ref.cardId)) ids.push(ref.cardId);
  }
  return ids;
}

function appliedGeometry(
  move: ReturnType<typeof resizeMove>,
  fallback: Rect,
): { x: number; y: number; width: number; height: number } | null {
  if (!move) return null;
  return {
    x: move.x,
    y: move.y,
    width: move.width ?? fallback.width,
    height: move.height ?? fallback.height,
  };
}

function offsetRects(rects: ReadonlyMap<string, Rect>, dx: number, dy: number): Map<string, Rect> {
  const next = new Map<string, Rect>();
  for (const [key, rect] of rects) {
    next.set(key, { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height });
  }
  return next;
}

/**
 * Owns every pointer gesture on the scene surface: selection, marquee,
 * multi-card drag and resize, section drag and resize, edge selection,
 * connector drag and portal focus. Canonical geometry only changes on pointer
 * up, through `movePlacements` / `updatePlacementGeometry` /
 * `moveSectionsBatch` / `updateSectionGeometry`; while a gesture runs, the layer
 * renders page-space overrides instead.
 */
export function useSceneInteraction({
  scene,
  canEditLayout,
  workspace,
  onFocusPortal,
  planSectionMove,
  connectorsFor,
  createConnector,
}: UseSceneInteractionOptions): SceneInteraction {
  const selectedIds = useUiStore((state) => state.selectedNodeIds);
  const selectedSectionId = useUiStore((state) => state.selectedSectionId);
  const selectedEdgeIds = useUiStore((state) => state.selectedEdgeIds);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Rect>>(() => new Map());
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [connectorDrag, setConnectorDrag] = useState<{ from: Point; to: Point } | null>(null);
  const gesture = useRef<SceneGesture | null>(null);

  const setPresencePointer = usePresenceStore((state) => state.setPointer);
  const setPresenceDragging = usePresenceStore((state) => state.setDragging);
  const setPresenceSelection = usePresenceStore((state) => state.setSelection);
  const setPresenceSelectionBox = usePresenceStore((state) => state.setSelectionBox);
  const setPresenceResizing = usePresenceStore((state) => state.setResizing);
  const setPresenceSectionDrag = usePresenceStore((state) => state.setSectionDrag);
  const setPresenceSectionResize = usePresenceStore((state) => state.setSectionResize);

  const lastPointerSent = useRef(0);
  const lastGestureSent = useRef(0);
  /** True from the marquee press to its release, so selection publishes once. */
  const marqueeActive = useRef(false);

  /**
   * Page space is the root board's own space (its instance transform is the
   * identity), so these samples mean the same thing on the flow surface.
   */
  const publishPointer = useCallback(
    (page: Point) => {
      const now = performance.now();
      if (now - lastPointerSent.current < POINTER_THROTTLE_MS) return;
      lastPointerSent.current = now;
      setPresencePointer({ x: page.x, y: page.y });
    },
    [setPresencePointer],
  );

  const publishGesture = useCallback((publish: () => void) => {
    const now = performance.now();
    if (now - lastGestureSent.current < GESTURE_THROTTLE_MS) return;
    lastGestureSent.current = now;
    publish();
  }, []);

  const boardIdFor = useCallback(
    (instanceKey: string): string | undefined =>
      scene.cards.find((card) => card.key === instanceKey)?.boardId ??
      scene.portals.find((portal) => portal.key === instanceKey)?.boardId,
    [scene],
  );

  // One publisher for the selection, like the flow surface: gestures publish
  // their own state and the closed selection is written once.
  useEffect(() => {
    if (marqueeActive.current) return;
    const hasSelection =
      selectedIds.length > 0 || selectedEdgeIds.length > 0 || selectedSectionId !== null;
    setPresenceSelection(
      hasSelection
        ? {
            nodeIds: [...selectedIds],
            edgeIds: [...selectedEdgeIds],
            ...(selectedSectionId ? { sectionId: selectedSectionId } : {}),
          }
        : null,
    );
  }, [selectedEdgeIds, selectedIds, selectedSectionId, setPresenceSelection]);

  // A surface that unmounts mid-gesture must not leave a ghost behind.
  useEffect(
    () => () => {
      setPresencePointer(null);
      setPresenceDragging(null);
      setPresenceSectionDrag(null);
      setPresenceResizing(null);
      setPresenceSectionResize(null);
      setPresenceSelectionBox(null);
    },
    [
      setPresenceDragging,
      setPresencePointer,
      setPresenceResizing,
      setPresenceSectionDrag,
      setPresenceSectionResize,
      setPresenceSelectionBox,
    ],
  );

  const connectorHandles = useMemo(
    () => resolveConnectorHandles(scene, selectedIds, createConnector ? connectorsFor : undefined),
    [connectorsFor, createConnector, scene, selectedIds],
  );

  const applySelection = useCallback((ids: string[]) => {
    const state = useUiStore.getState();
    if (state.selectedSectionId !== null) state.selectSection(null);
    if (state.selectedEdgeIds.length > 0) state.setSelectedEdgeIds([]);
    if (sameIds(state.selectedNodeIds, ids)) return;
    state.setSelectedNodeIds(ids);
  }, []);

  const applySectionSelection = useCallback((sectionId: string) => {
    const state = useUiStore.getState();
    if (state.selectedNodeIds.length > 0) state.setSelectedNodeIds([]);
    if (state.selectedEdgeIds.length > 0) state.setSelectedEdgeIds([]);
    if (state.selectedSectionId !== sectionId) state.selectSection(sectionId);
  }, []);

  const applyEdgeSelection = useCallback((edgeId: string, shift: boolean) => {
    const state = useUiStore.getState();
    const current = state.selectedEdgeIds;
    const next = shift
      ? current.includes(edgeId)
        ? current.filter((id) => id !== edgeId)
        : [...current, edgeId]
      : sameIds(current, [edgeId])
        ? current
        : [edgeId];
    if (state.selectedSectionId !== null) state.selectSection(null);
    if (state.selectedNodeIds.length > 0) state.setSelectedNodeIds([]);
    if (!sameIds(current, next)) state.setSelectedEdgeIds(next);
  }, []);

  const clearGesture = useCallback(() => {
    gesture.current = null;
    marqueeActive.current = false;
    setOverrides(new Map());
    setMarquee(null);
    setConnectorDrag(null);
    setPresenceDragging(null);
    setPresenceSectionDrag(null);
    setPresenceResizing(null);
    setPresenceSectionResize(null);
    setPresenceSelectionBox(null);
  }, [
    setPresenceDragging,
    setPresenceResizing,
    setPresenceSectionDrag,
    setPresenceSectionResize,
    setPresenceSelectionBox,
  ]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (gesture.current) return;
      const element = event.currentTarget;
      // Claim the primary button from React Flow's pan; middle/right still pan.
      event.stopPropagation();
      const screen = screenPointOf(element, event);
      const camera = scene.camera;
      const page = screenToPage(camera, screen);
      capturePointer(element, event.pointerId);

      const state = useUiStore.getState();
      const current = state.selectedNodeIds;
      const shift = event.shiftKey;

      // Handles sit on the box edge and reach past it, so they win the pick.
      if (canEditLayout) {
        const target =
          resolveResizeTarget(scene, current) ??
          resolveSectionResizeTarget(scene, state.selectedSectionId);
        if (target) {
          const rect = overrides.get(target.instanceKey) ?? target.rect;
          const handle = resizeHandleAt(
            rect,
            page,
            resizeHandlePageSize(camera.zoom),
            resizeHandleSlop(camera.zoom),
          );
          if (handle) {
            gesture.current = {
              kind: "resize",
              pointerId: event.pointerId,
              startScreen: screen,
              moved: false,
              target,
              handle,
              startLocal: target.local,
            };
            element.style.cursor = resizeHandleCursor(handle);
            return;
          }
        }
      }

      // Connector handles sit just outside the card, so they beat the card body.
      if (connectorHandles.length > 0) {
        const handle = connectorHandleAt(connectorHandles, page, connectorHandleSlop(camera.zoom));
        if (handle) {
          gesture.current = {
            kind: "connector",
            pointerId: event.pointerId,
            startScreen: screen,
            moved: false,
            handle,
            boardId: handle.boardId,
            cardId: handle.cardId,
          };
          element.style.cursor = "crosshair";
          return;
        }
      }

      const hit = hitTest(scene, camera, screen);
      if (hit.kind === "card" || hit.kind === "portal") {
        const cardId = hit.cardId;
        const selected = current.includes(cardId);
        const next = shift
          ? selected
            ? current.filter((id) => id !== cardId)
            : [...current, cardId]
          : selected
            ? current
            : [cardId];
        applySelection(next);

        const canDrag = canEditLayout && next.includes(cardId);
        const session = canDrag
          ? beginDrag({
              scene,
              camera,
              screenPoint: screen,
              instanceKeys: instanceKeysFor(scene, new Set(next)),
            })
          : null;
        gesture.current = {
          kind: "card",
          pointerId: event.pointerId,
          startScreen: screen,
          moved: false,
          hit,
          session,
          startRects: session ? pageRectsFor(session) : new Map(),
        };
        element.style.cursor = session ? "grabbing" : "";
        return;
      }

      if (hit.kind === "section") {
        // A section press selects the section; it never starts a card marquee.
        applySectionSelection(hit.sectionId);
        const instance = scene.sections.find((entry) => entry.key === hit.instanceKey);
        const plan = canEditLayout && planSectionMove ? planSectionMove(hit.sectionId) : null;
        gesture.current = {
          kind: "section",
          pointerId: event.pointerId,
          startScreen: screen,
          moved: false,
          sectionId: hit.sectionId,
          startPage: page,
          plan,
          transform: instance?.transform ?? { x: 0, y: 0, scale: 1 },
          startRects: plan ? sectionStartRects(scene, plan) : new Map(),
        };
        element.style.cursor = plan ? "grabbing" : "";
        return;
      }

      if (hit.kind === "edge") {
        applyEdgeSelection(hit.edgeId, shift);
        gesture.current = {
          kind: "edge",
          pointerId: event.pointerId,
          startScreen: screen,
          moved: false,
        };
        return;
      }

      // Empty space: marquee cards and clear every other selection.
      const base = shift ? current : [];
      if (!shift || state.selectedSectionId !== null || state.selectedEdgeIds.length > 0) {
        applySelection(base);
      }
      // Until the box closes, the marquee is the gesture peers should see.
      marqueeActive.current = true;
      lastGestureSent.current = 0;
      gesture.current = {
        kind: "marquee",
        pointerId: event.pointerId,
        startScreen: screen,
        moved: false,
        startPage: page,
        base,
      };
      element.style.cursor = "crosshair";
    },
    [
      applyEdgeSelection,
      applySectionSelection,
      applySelection,
      canEditLayout,
      connectorHandles,
      overrides,
      planSectionMove,
      scene,
    ],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const active = gesture.current;
      if (!active || active.pointerId !== event.pointerId) {
        // Hover: paint the gesture affordance the pointer would start.
        const screen = screenPointOf(element, event);
        const camera = scene.camera;
        const page = screenToPage(camera, screen);
        publishPointer(page);
        const state = useUiStore.getState();
        const connectorHandle = connectorHandleAt(
          connectorHandles,
          page,
          connectorHandleSlop(camera.zoom),
        );
        if (connectorHandle) {
          element.style.cursor = "crosshair";
          return;
        }
        if (canEditLayout) {
          const target =
            resolveResizeTarget(scene, state.selectedNodeIds) ??
            resolveSectionResizeTarget(scene, state.selectedSectionId);
          const handle = target
            ? resizeHandleAt(
                overrides.get(target.instanceKey) ?? target.rect,
                page,
                resizeHandlePageSize(camera.zoom),
                resizeHandleSlop(camera.zoom),
              )
            : null;
          if (handle) {
            element.style.cursor = resizeHandleCursor(handle);
            return;
          }
        }
        const hit = hitTest(scene, camera, screen);
        if (hit.kind === "card") element.style.cursor = canEditLayout ? "grab" : "default";
        else if (hit.kind === "portal") {
          element.style.cursor =
            !hit.expanded || hit.part === "header" ? "zoom-in" : canEditLayout ? "grab" : "default";
        } else if (hit.kind === "section") {
          element.style.cursor = canEditLayout && planSectionMove ? "grab" : "default";
        } else if (hit.kind === "edge") element.style.cursor = "pointer";
        else element.style.cursor = "default";
        return;
      }

      const screen = screenPointOf(element, event);
      if (!active.moved && distance(active.startScreen, screen) > SCENE_DRAG_THRESHOLD) {
        active.moved = true;
      }
      if (!active.moved) return;
      const camera = scene.camera;
      publishPointer(screenToPage(camera, screen));

      if (active.kind === "card") {
        const session = active.session;
        if (!session) return;
        const page = screenToPage(camera, screen);
        setOverrides(
          offsetRects(
            active.startRects,
            page.x - session.startPage.x,
            page.y - session.startPage.y,
          ),
        );
        // Presence carries the anchor's board-space position plus the whole
        // canonical set, exactly as the flow surface publishes a node drag.
        const hit = active.hit;
        const anchorId = hit.kind === "card" || hit.kind === "portal" ? hit.cardId : null;
        const anchor =
          session.items.find((item) => item.instanceKey === hit.instanceKey) ?? session.items[0];
        const scale =
          anchor && Number.isFinite(anchor.transform.scale) && anchor.transform.scale > 0
            ? anchor.transform.scale
            : 1;
        if (anchorId) {
          publishGesture(() => {
            setPresenceDragging({
              nodeId: anchorId,
              position: {
                x: (anchor?.startLocal.x ?? 0) + (page.x - session.startPage.x) / scale,
                y: (anchor?.startLocal.y ?? 0) + (page.y - session.startPage.y) / scale,
              },
              nodeIds: [...session.cardIds],
              ...(anchor ? { boardId: anchor.boardId } : {}),
            });
          });
        }
        element.style.cursor = "grabbing";
        return;
      }

      if (active.kind === "section") {
        if (!active.plan) return;
        const page = screenToPage(camera, screen);
        setOverrides(
          offsetRects(active.startRects, page.x - active.startPage.x, page.y - active.startPage.y),
        );
        const root = active.plan.sections.find((section) => section.id === active.sectionId);
        const scale =
          Number.isFinite(active.transform.scale) && active.transform.scale > 0
            ? active.transform.scale
            : 1;
        if (root) {
          publishGesture(() => {
            setPresenceSectionDrag({
              sectionId: active.sectionId,
              position: {
                x: root.x + (page.x - active.startPage.x) / scale,
                y: root.y + (page.y - active.startPage.y) / scale,
              },
            });
          });
        }
        element.style.cursor = "grabbing";
        return;
      }

      if (active.kind === "connector") {
        setConnectorDrag({ from: active.handle.point, to: screenToPage(camera, screen) });
        element.style.cursor = "crosshair";
        return;
      }

      if (active.kind === "edge") return;

      if (active.kind === "resize") {
        const dx = screen.x - active.startScreen.x;
        const dy = screen.y - active.startScreen.y;
        const live = resizeFromHandle({
          scene,
          camera,
          instanceKey: active.target.instanceKey,
          handle: active.handle,
          screenDelta: { x: dx, y: dy },
          ...(active.target.sectionId === null ? {} : { minSize: SECTION_MIN_SIZE }),
        });
        setOverrides(
          new Map([[active.target.instanceKey, transformRect(active.target.transform, live)]]),
        );
        // `live` is board space, which is what peers need to reproduce the box
        // in every instance of the same card and in the flow surface.
        publishGesture(() => {
          if (active.target.sectionId !== null) {
            setPresenceSectionResize({
              sectionId: active.target.sectionId,
              position: { x: live.x, y: live.y },
              width: live.width,
              height: live.height,
            });
            return;
          }
          if (active.target.cardId === null) return;
          const boardId = boardIdFor(active.target.instanceKey);
          setPresenceResizing({
            nodeId: active.target.cardId,
            position: { x: live.x, y: live.y },
            width: live.width,
            height: live.height,
            ...(boardId ? { boardId } : {}),
          });
        });
        element.style.cursor = resizeHandleCursor(active.handle);
        return;
      }

      const page = screenToPage(camera, screen);
      const box = marqueeRect(active.startPage, page);
      setMarquee(box);
      // The marquee is a gesture: peers watch the box itself, not the frame's
      // selection echo, which lands once on release.
      publishGesture(() => {
        setPresenceSelectionBox({ x: box.x, y: box.y, width: box.width, height: box.height });
      });
      const ids = marqueeCardIds(scene, active.startScreen, screen);
      applySelection(unionIds(active.base, ids));
      element.style.cursor = "crosshair";
    },
    [
      applySelection,
      boardIdFor,
      canEditLayout,
      connectorHandles,
      overrides,
      planSectionMove,
      publishGesture,
      publishPointer,
      scene,
      setPresenceDragging,
      setPresenceResizing,
      setPresenceSectionDrag,
      setPresenceSectionResize,
      setPresenceSelectionBox,
    ],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const active = gesture.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const element = event.currentTarget;
      releasePointer(element, event.pointerId);
      gesture.current = null;
      const screen = screenPointOf(element, event);
      const moved = active.moved || distance(active.startScreen, screen) > SCENE_DRAG_THRESHOLD;
      setOverrides(new Map());
      setMarquee(null);
      setConnectorDrag(null);
      element.style.cursor = "";

      // A gesture ends on release, whatever path it took: peers must never keep
      // a ghost because the pointer lifted outside a branch below.
      if (active.kind === "card" && active.session) setPresenceDragging(null);
      if (active.kind === "section" && active.plan) setPresenceSectionDrag(null);
      if (active.kind === "resize") {
        setPresenceResizing(null);
        setPresenceSectionResize(null);
      }
      if (active.kind === "marquee") {
        // The box was the gesture; the selection it left behind is published once.
        marqueeActive.current = false;
        setPresenceSelectionBox(null);
        const live = useUiStore.getState();
        const hasSelection =
          live.selectedNodeIds.length > 0 ||
          live.selectedEdgeIds.length > 0 ||
          live.selectedSectionId !== null;
        setPresenceSelection(
          hasSelection
            ? {
                nodeIds: [...live.selectedNodeIds],
                edgeIds: [...live.selectedEdgeIds],
                ...(live.selectedSectionId ? { sectionId: live.selectedSectionId } : {}),
              }
            : null,
        );
      }

      if (active.kind === "card") {
        if (active.session && moved) {
          const page = screenToPage(scene.camera, screen);
          const dx = page.x - active.session.startPage.x;
          const dy = page.y - active.session.startPage.y;
          if (Math.abs(dx) > COMMIT_EPSILON || Math.abs(dy) > COMMIT_EPSILON) {
            const byBoard = new Map<string, { cardId: string; x: number; y: number }[]>();
            for (const move of dragDelta(active.session, page)) {
              if (!move.cardId) continue;
              const bucket = byBoard.get(move.boardId);
              const entry = { cardId: move.cardId, x: move.x, y: move.y };
              if (bucket) bucket.push(entry);
              else byBoard.set(move.boardId, [entry]);
            }
            // One commit per board; `movePlacements` stays silent when nothing moved.
            for (const [boardId, moves] of byBoard) {
              if (moves.length > 0) workspace.movePlacements(boardId, moves);
            }
          }
          return;
        }
        // A press that never moved is a click: portal headers focus on it.
        if (!moved && active.hit.kind === "portal") {
          const hit = active.hit;
          const portal = scene.portals.find((entry) => entry.key === hit.instanceKey);
          // A collapsed frame is entirely a focus target; a live one only from
          // its header, so the child board keeps its own gestures.
          const focusable =
            portal !== undefined &&
            !portal.targetMissing &&
            (!hit.expanded || hit.part === "header");
          if (portal && focusable) onFocusPortal?.(portal);
        }
        return;
      }

      if (active.kind === "section") {
        if (!active.plan || !moved) return;
        const page = screenToPage(scene.camera, screen);
        const scale = active.transform.scale;
        if (!Number.isFinite(scale) || Math.abs(scale) < COMMIT_EPSILON) return;
        const dx = (page.x - active.startPage.x) / scale;
        const dy = (page.y - active.startPage.y) / scale;
        if (Math.abs(dx) <= COMMIT_EPSILON && Math.abs(dy) <= COMMIT_EPSILON) return;
        // Members ride along in the same write, so a drop is one undo step.
        workspace.moveSectionsBatch({
          sections: active.plan.sections.map((section) => ({
            id: section.id,
            x: section.x + dx,
            y: section.y + dy,
          })),
          ...(active.plan.placements.length === 0
            ? {}
            : {
                placements: active.plan.placements.map((placement) => ({
                  boardId: placement.boardId,
                  cardId: placement.cardId,
                  x: placement.x + dx,
                  y: placement.y + dy,
                })),
              }),
        });
        return;
      }

      if (active.kind === "edge") return;

      if (active.kind === "connector") {
        if (!moved || !createConnector) return;
        const page = screenToPage(scene.camera, screen);
        const hit = hitTest(scene, scene.camera, screen);
        if (hit.kind !== "card" && hit.kind !== "portal") return;
        // An edge lives on one board, so a drop across boards commits nothing.
        if (hit.cardId === active.cardId || hit.boardId !== active.boardId) return;
        const rect = hit.kind === "card" ? hit.rect : hit.frame;
        const connectors = connectorsFor?.(hit.cardId) ?? [];
        createConnector({
          boardId: hit.boardId,
          sourceCardId: active.cardId,
          targetCardId: hit.cardId,
          sourceConnectorId: active.handle.connectorId,
          targetConnectorId: connectorIdForSide(connectors, nearestConnectorSide(rect, page)),
        });
        return;
      }

      if (active.kind === "resize") {
        if (!moved) return;
        const move = resizeMove({
          scene,
          camera: scene.camera,
          instanceKey: active.target.instanceKey,
          handle: active.handle,
          screenDelta: {
            x: screen.x - active.startScreen.x,
            y: screen.y - active.startScreen.y,
          },
          ...(active.target.sectionId === null ? {} : { minSize: SECTION_MIN_SIZE }),
        });
        const geometry = appliedGeometry(move, active.startLocal);
        if (!move || !geometry) return;
        if (rectEquals(geometry, active.startLocal)) return;
        if (move.sectionId) {
          workspace.updateSectionGeometry(move.sectionId, geometry);
          return;
        }
        if (!move.cardId) return;
        workspace.updatePlacementGeometry(move.boardId, move.cardId, geometry);
      }
    },
    [
      connectorsFor,
      createConnector,
      onFocusPortal,
      scene,
      setPresenceDragging,
      setPresenceResizing,
      setPresenceSectionDrag,
      setPresenceSectionResize,
      setPresenceSelection,
      setPresenceSelectionBox,
      workspace,
    ],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!gesture.current || gesture.current.pointerId !== event.pointerId) return;
      releasePointer(event.currentTarget, event.pointerId);
      event.currentTarget.style.cursor = "";
      clearGesture();
    },
    [clearGesture],
  );

  const onPointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (gesture.current) return;
      event.currentTarget.style.cursor = "";
      setPresencePointer(null);
    },
    [setPresencePointer],
  );

  // Escape drops the surface's own state first. The scene's focus path handles
  // Escape in the capture phase and marks it handled, so a back-navigation never
  // also clears the selection.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const state = useUiStore.getState();
      const idle =
        gesture.current === null &&
        state.selectedNodeIds.length === 0 &&
        state.selectedSectionId === null &&
        state.selectedEdgeIds.length === 0;
      if (idle) return;
      if (state.editingNodeId !== null) return;
      clearGesture();
      state.selectSection(null);
      state.setSelectedEdgeIds([]);
      state.setSelectedNodeIds([]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearGesture]);

  return {
    selectedIds,
    selectedSectionId,
    selectedEdgeIds,
    overrides,
    marquee,
    connectorHandles,
    connectorDrag,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
    },
  };
}
