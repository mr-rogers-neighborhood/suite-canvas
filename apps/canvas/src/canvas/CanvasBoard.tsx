import type { Card, GraphEdge, LayerAction, Placement, Rect } from "@suite/graph";
import { sectionMembership, sectionMovePlan, unionRect } from "@suite/graph";
import {
  Background,
  type Connection,
  ConnectionMode,
  Controls,
  type Edge,
  getViewportForBounds,
  type HandleType,
  MarkerType,
  type Node,
  type NodeChange,
  type OnConnectEnd,
  type OnConnectStart,
  ReactFlow,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useOnSelectionChange,
  useReactFlow,
  useStore,
  useStoreApi,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CardMeta, cardMeta } from "../cards/cardMeta";
import { resolveCardType, typesById } from "../cards/cardTypes";
import { isPortalCard, portalTargetId } from "../cards/portal";
import { ensureWhiteboardType, isWhiteboardCard } from "../cards/whiteboard";
import type { ConnectState } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { ContextMenu } from "../components/ContextMenu";
import { markBoot, measureBoot } from "../dev/bootTiming";
import { countRender } from "../dev/perf";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { type EdgeDescriptionData, EdgeDescriptionInput, edgeTypes } from "./EdgeDescription";
import { LocalDragEase, prefersReducedMotion } from "./localEasing";
import {
  DEFAULT_CARD_HEIGHT,
  DEFAULT_CARD_WIDTH,
  dragMoves,
  dragRects,
  layerActions,
  orderedSelection,
} from "./multiSelect";
import { nodeTypes } from "./NoteNode";
import type { CardNodeData } from "./nodeData";
import { PeerReconnectLayer } from "./PeerReconnectLayer";
import { portalSizeForBounds } from "./PortalCard";
import { PortalNode } from "./PortalNode";
import { PortalTransitionLayer } from "./PortalTransitionLayer";
import { PresenceLayer } from "./PresenceLayer";
import { boardBounds } from "./portalMiniature";
import { SectionLayer } from "./SectionLayer";
import { cardSectionOffsets, sectionOffsets, sectionsExpandPlan } from "./sectionLayout";
import { useCanvasMenuItems } from "./useCanvasMenuItems";
import { WhiteboardNode } from "./WhiteboardNode";

/** Share of the remaining distance covered per frame when easing toward a peer's drag. */
const SMOOTHING = 0.22;
const POINTER_THROTTLE_MS = 60;
const DRAG_THROTTLE_MS = 40;
/** How long a focus request waits for React Flow to register the card's node. */
const FOCUS_POLL_TIMEOUT_MS = 1500;
/** Card box assumed until React Flow has measured it. */
const FOCUS_FALLBACK_SIZE = { width: 224, height: 160 };
const FOCUS_DURATION_MS = 300;
/** A focused card or section should not fill the screen. */
const FOCUS_MAX_ZOOM = 1.2;
/**
 * Share of the canvas a portal must cover, while zooming in, before the camera
 * takes it as an intent to enter. A portal "filling most of the viewport" is a
 * doorway; brushing past one is not.
 */
const PORTAL_ZOOM_COVERAGE = 0.82;
/** Zooming out by this share of the gesture's starting zoom is a step back. */
const PORTAL_ZOOM_BACK_RATIO = 0.5;

/** React Flow node types; a portal card paints its target instead of a note. */
const canvasNodeTypes = { ...nodeTypes, portal: PortalNode, whiteboard: WhiteboardNode };

const EMPTY_META: CardMeta = { properties: [], tags: [] };

/** The connector a local new-link drag started from, minus the live pointer. */
type ConnectAnchor = Omit<ConnectState, "position" | "target">;

/**
 * True when a right-click landed in rich text that is being edited. The
 * browser's native menu (copy, paste, spelling) is more useful there than the
 * card menu. A read-only ProseMirror body keeps the card menu, which is how
 * right-clicking a card without an active editor reaches it. Field mentions
 * and property blocks handle their own context menu earlier and stop
 * propagation, so they still open the app menu.
 */
function isEditorTarget(event: { target: EventTarget | null }): boolean {
  const target = event.target as HTMLElement | null;
  const editor = target?.closest<HTMLElement>(".ProseMirror");
  if (!editor) return false;
  return editor.isContentEditable || editor.getAttribute("contenteditable") === "true";
}

/** Client coordinates of a mouse or touch event, when it carries any. */
function clientPoint(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.touches[0] ?? event.changedTouches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

/**
 * Publishes a gesture's pointer samples at most once per `DRAG_THROTTLE_MS`,
 * plus a trailing sample so a pointer that stops still lands on every peer.
 */
function followPointer(
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number },
  publish: (position: { x: number; y: number }) => void,
) {
  let lastSent = 0;
  let pending: { x: number; y: number } | null = null;
  let trailing: ReturnType<typeof setTimeout> | null = null;

  const follow = (event: PointerEvent) => {
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const wait = DRAG_THROTTLE_MS - (performance.now() - lastSent);
    if (wait <= 0) {
      lastSent = performance.now();
      publish(position);
      return;
    }
    pending = position;
    if (trailing !== null) return;
    trailing = setTimeout(() => {
      trailing = null;
      if (!pending) return;
      lastSent = performance.now();
      publish(pending);
      pending = null;
    }, wait);
  };

  const stop = () => {
    if (trailing !== null) clearTimeout(trailing);
    trailing = null;
    pending = null;
  };

  return { follow, stop };
}

function toFlowEdge(
  edge: GraphEdge,
  selected: boolean,
  data: Pick<EdgeDescriptionData, "onLabelDrag" | "onLabelEdit">,
  peerColor?: string,
): Edge {
  const marker = {
    type: MarkerType.ArrowClosed,
    width: 18,
    height: 18,
    ...(peerColor ? { color: peerColor } : {}),
  };

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "description",
    // One edge component renders every routing style; path and label placement
    // travel with it, along with the callbacks that make the label draggable.
    data: {
      path: edge.path,
      ...(edge.labelOffset === undefined ? {} : { labelOffset: edge.labelOffset }),
      ...data,
    } satisfies EdgeDescriptionData,
    selected,
    ...(edge.sourceConnector ? { sourceHandle: edge.sourceConnector } : {}),
    ...(edge.targetConnector ? { targetHandle: edge.targetConnector } : {}),
    ...(edge.label ? { label: edge.label } : {}),
    ...(peerColor ? { style: { stroke: peerColor, strokeWidth: 2 } } : {}),
    markerEnd: marker,
    ...(edge.bidirectional ? { markerStart: marker } : {}),
  };
}

export function CanvasBoard() {
  countRender("canvas");

  useEffect(() => {
    markBoot("canvas:mounted");
    measureBoot("to-canvas", "store:created", "canvas:mounted");
  }, []);

  const snapshot = useWorkspaceSnapshot();
  const workspace = useCanvasStore((state) => state.workspace);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const peers = useBoardPeers(activeBoardId);
  const setPointer = usePresenceStore((state) => state.setPointer);
  const setDragging = usePresenceStore((state) => state.setDragging);
  const setPresenceSelection = usePresenceStore((state) => state.setSelection);
  const setSelectionBox = usePresenceStore((state) => state.setSelectionBox);
  const setReconnect = usePresenceStore((state) => state.setReconnect);
  const setConnect = usePresenceStore((state) => state.setConnect);
  const setSectionDragPresence = usePresenceStore((state) => state.setSectionDrag);
  const setSectionResizePresence = usePresenceStore((state) => state.setSectionResize);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const selectedConnector = useUiStore((state) => state.selectedConnector);
  const selectedSectionId = useUiStore((state) => state.selectedSectionId);
  const selectSection = useUiStore((state) => state.selectSection);
  const editingSectionId = useUiStore((state) => state.editingSectionId);
  const setEditingSection = useUiStore((state) => state.setEditingSection);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);
  const selectedEdgeIds = useUiStore((state) => state.selectedEdgeIds);
  const setSelectedEdgeIds = useUiStore((state) => state.setSelectedEdgeIds);
  const startEditing = useUiStore((state) => state.startEditing);
  const setSelectedConnector = useUiStore((state) => state.setSelectedConnector);
  const openContextMenu = useUiStore((state) => state.openContextMenu);
  const closeContextMenu = useUiStore((state) => state.closeContextMenu);
  const stopEditing = useUiStore((state) => state.stopEditing);
  const contextMenu = useUiStore((state) => state.contextMenu);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canCreateContent = useUiStore((state) => state.canCreateContent);
  const canCreateBoards = useUiStore((state) => state.canCreateBoards);
  const canManageTrash = useUiStore((state) => state.canManageTrash);
  const canManageLinks = useUiStore((state) => state.canManageLinks);
  const requestShare = useUiStore((state) => state.requestShare);
  // Sections and connectors are workspace structure, not draft objects, so
  // removing one follows the trash row of the matrix: owner and workspace
  // editor tokens only, never a board or card draft.
  const canManageStructure = canManageTrash;
  const setActiveBoardId = useUiStore((state) => state.setActiveBoardId);
  const focusTarget = useUiStore((state) => state.focusTarget);
  const clearFocusTarget = useUiStore((state) => state.clearFocusTarget);
  const { screenToFlowPosition, setViewport, getViewport, fitView } = useReactFlow();
  const store = useStoreApi();
  const requestPortalEntry = useUiStore((state) => state.requestPortalEntry);
  const recordBoardViewport = useUiStore((state) => state.recordBoardViewport);
  const goBackBoard = useUiStore((state) => state.goBackBoard);
  const viewportRequest = useUiStore((state) => state.viewportRequest);
  const clearViewportRequest = useUiStore((state) => state.clearViewportRequest);
  const openCardFocus = useUiStore((state) => state.openCardFocus);

  const [nodes, setNodes, applyNodeChanges] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reconnecting, setReconnecting] = useState<{
    edgeId: string;
    end: HandleType;
    /** The connector that stays put, so a snap onto it is not mistaken for a target. */
    anchorConnector: string | null;
  } | null>(null);
  const [connecting, setConnecting] = useState<ConnectAnchor | null>(null);
  const [edgeDescription, setEdgeDescription] = useState<{
    edgeId: string;
    x: number;
    y: number;
    value: string;
  } | null>(null);

  // Board-scoped views derived from the snapshot, so a CRDT change anywhere
  // recomputes exactly once per board.
  const boardPlacements = useMemo(() => {
    const map = new Map<string, Placement>();
    if (!activeBoardId) return map;
    for (const placement of snapshot.placements) {
      if (placement.boardId === activeBoardId) map.set(placement.cardId, placement);
    }
    return map;
  }, [snapshot, activeBoardId]);

  const cardsById = useMemo(
    () => new Map(snapshot.cards.map((card) => [card.id, card])),
    [snapshot],
  );

  const boardCards: Card[] = useMemo(() => {
    if (!activeBoardId) return [];
    return [...boardPlacements.values()]
      .sort((a, b) => a.z - b.z || a.createdAt - b.createdAt || a.cardId.localeCompare(b.cardId))
      .flatMap((placement) => {
        const card = cardsById.get(placement.cardId);
        return card && !card.deletedAt ? [card] : [];
      });
  }, [boardPlacements, cardsById, activeBoardId]);

  const boardEdges: GraphEdge[] = useMemo(() => {
    if (!activeBoardId) return [];
    const placed = new Set(boardCards.map((card) => card.id));
    return snapshot.edges.filter(
      (edge) =>
        edge.boardId === activeBoardId && placed.has(edge.source) && placed.has(edge.target),
    );
  }, [snapshot, boardCards, activeBoardId]);

  const boardPlacementList = useMemo(() => [...boardPlacements.values()], [boardPlacements]);

  /** Board cards in paint order (bottom to top), the order layer actions apply in. */
  const boardOrder = useMemo(() => boardCards.map((card) => card.id), [boardCards]);

  const boardSections = useMemo(() => {
    if (!activeBoardId) return [];
    return snapshot.sections.filter((section) => section.boardId === activeBoardId);
  }, [snapshot.sections, activeBoardId]);

  const sectionMembershipMap = useMemo(
    () => sectionMembership(boardPlacementList, boardSections),
    [boardPlacementList, boardSections],
  );

  const [localSectionDrag, setLocalSectionDrag] = useState<{
    sectionId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [localSectionResize, setLocalSectionResize] = useState<{
    sectionId: string;
    rect: Rect;
  } | null>(null);
  const lastSectionPublish = useRef(0);

  const sectionGestures = useMemo(() => {
    const gestures: { sectionId: string; position: { x: number; y: number } }[] = [];
    if (localSectionDrag) gestures.push(localSectionDrag);
    for (const peer of Object.values(peers)) {
      if (peer.sectionDrag) gestures.push(peer.sectionDrag);
    }
    return gestures;
  }, [localSectionDrag, peers]);

  const sectionOffsetsMap = useMemo(
    () => sectionOffsets(boardSections, sectionGestures),
    [boardSections, sectionGestures],
  );

  const sectionResizes = useMemo(() => {
    const map = new Map<string, Rect>();
    for (const peer of Object.values(peers)) {
      const resizing = peer.sectionResize;
      if (!resizing) continue;
      map.set(resizing.sectionId, {
        x: resizing.position.x,
        y: resizing.position.y,
        width: resizing.width,
        height: resizing.height,
      });
    }
    if (localSectionResize) map.set(localSectionResize.sectionId, localSectionResize.rect);
    return map;
  }, [peers, localSectionResize]);

  const cardOffsetsMap = useMemo(
    () => cardSectionOffsets(sectionMembershipMap, sectionOffsetsMap),
    [sectionMembershipMap, sectionOffsetsMap],
  );

  const typeMap = useMemo(() => typesById(snapshot.types), [snapshot.types]);
  const tagMap = useMemo(() => new Map(snapshot.tags.map((tag) => [tag.id, tag])), [snapshot.tags]);
  const metaByCard = useMemo(() => {
    const map = new Map<string, CardMeta>();
    for (const card of snapshot.cards) map.set(card.id, cardMeta(card, typeMap, tagMap));
    return map;
  }, [snapshot.cards, typeMap, tagMap]);

  /** Cards this client is dragging; React Flow owns their live positions. */
  const locallyDraggingIds = useRef(new Set<string>());
  /** Cards in the current drag gesture, anchor included; published to peers. */
  const draggedNodeIds = useRef<string[]>([]);
  /** Board cards in paint order; Cmd/Ctrl+A selects exactly these. */
  const boardCardIds = useRef<string[]>([]);
  /** Nodes this client is resizing; React Flow owns their live corner. */
  const locallyResizing = useRef(new Set<string>());
  /** React Flow reports edge-updater drags through onConnectStart too. */
  const reconnectGesture = useRef(false);
  const lastPointerSent = useRef(0);
  const lastDragSent = useRef(0);
  const selectedKey = selectedNodeIds.join(",");
  /**
   * The selection key `applyBoardNodes` last painted. React Flow mirrors its own
   * selection into the store asynchronously (through `onSelectionChange`), so a
   * rebuild in between — a peer's pointer tick is enough — would paint the
   * previous selection back over a marquee that is still in flight. Only an
   * explicit selection change re-derives `selected`; otherwise React Flow's live
   * value wins.
   */
  const paintedSelection = useRef(selectedKey);
  /**
   * React Flow owns the selection while a marquee runs. Repainting `selected`
   * from the store mid-gesture makes the pane diff against a stale set and skip
   * re-selecting a card that is still inside the box.
   */
  const marqueeActive = useRef(false);
  /**
   * The rendered (eased) positions of this client's drag. React Flow paints the
   * pointer sample; this eases it, so the board does not step on a dropped
   * frame. `null` outside a drag and when reduced motion is requested.
   */
  const localEase = useRef<LocalDragEase | null>(null);
  const localEaseFrame = useRef<number | null>(null);

  useEffect(() => {
    boardCardIds.current = boardOrder;
  }, [boardOrder]);

  /**
   * The selection React Flow holds right now. While a marquee is in flight this
   * is the only authority: the store echo arrives a frame late, and painting
   * that echo back over the pane is what cleared the box mid-gesture.
   */
  const liveSelectedIds = useCallback((): Set<string> => {
    const ids = new Set<string>();
    for (const node of store.getState().nodeLookup.values()) {
      if (node.selected) ids.add(node.id);
    }
    return ids;
  }, [store]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const ease = localEase.current;
      const applied: NodeChange<Node>[] = [];
      for (const change of changes) {
        if (change.type === "dimensions") {
          if (change.resizing) locallyResizing.current.add(change.id);
          else locallyResizing.current.delete(change.id);
          applied.push(change);
          continue;
        }
        // A local drag is eased by the frame loop, not by the pointer sample:
        // the sample only updates the target, so a burst of events cannot make
        // the card step and the CRDT is still written once, at drop.
        if (change.type === "position" && change.position && ease?.tracks(change.id)) {
          ease.target(change.id, change.position);
          continue;
        }
        applied.push(change);
      }
      if (applied.length > 0) applyNodeChanges(applied);
    },
    [applyNodeChanges],
  );

  const stopLocalEase = useCallback(() => {
    if (localEaseFrame.current !== null) cancelAnimationFrame(localEaseFrame.current);
    localEaseFrame.current = null;
    localEase.current = null;
  }, []);

  const runLocalEase = useCallback(() => {
    if (localEaseFrame.current !== null) return;
    const tick = () => {
      localEaseFrame.current = null;
      const ease = localEase.current;
      if (!ease) return;
      const moved = ease.step(performance.now());
      if (moved.size > 0) {
        setNodes((current) =>
          current.map((node) => {
            const position = moved.get(node.id);
            return position ? { ...node, position, dragging: true } : node;
          }),
        );
      }
      if (ease.moving) localEaseFrame.current = requestAnimationFrame(tick);
    };
    localEaseFrame.current = requestAnimationFrame(tick);
  }, [setNodes]);

  // Remote drags are eased toward their latest reported position so motion on a
  // collaborator's screen reads as continuous instead of stepping.
  const peerTargets = useRef(new Map<string, { x: number; y: number }>());
  const smoothPositions = useRef(new Map<string, { x: number; y: number }>());
  const smoothingFrame = useRef<number | null>(null);
  const lastSmoothingTick = useRef(0);

  const runSmoothing = useCallback(() => {
    const tick = () => {
      lastSmoothingTick.current = performance.now();
      let moving = false;
      for (const [id, target] of peerTargets.current) {
        const previous = smoothPositions.current.get(id) ?? target;
        const x = previous.x + (target.x - previous.x) * SMOOTHING;
        const y = previous.y + (target.y - previous.y) * SMOOTHING;
        const settled = Math.abs(target.x - x) < 0.5 && Math.abs(target.y - y) < 0.5;
        smoothPositions.current.set(id, settled ? { ...target } : { x, y });
        if (!settled) moving = true;
      }

      // Smoothing rebuilds node objects, and a rebuild that carries a stale
      // `selected` clears React Flow's live marquee selection. While the box is
      // open, paint the selection React Flow reports instead of the old value.
      // A marquee is React Flow's gesture: a rebuild here replaces its live
      // `selected` with ours and empties the box under the pointer. Peer motion
      // pauses for the length of the gesture and lands when it closes.
      if (marqueeActive.current) {
        smoothingFrame.current = moving ? requestAnimationFrame(tick) : null;
        return;
      }
      setNodes((current) =>
        current.map((node) => {
          const position = smoothPositions.current.get(node.id);
          if (!position) return node;
          if (position.x === node.position.x && position.y === node.position.y) return node;
          return { ...node, position };
        }),
      );

      smoothingFrame.current = moving ? requestAnimationFrame(tick) : null;
    };

    if (smoothingFrame.current !== null) return;
    smoothingFrame.current = requestAnimationFrame(tick);
  }, [setNodes]);

  // React Flow owns transient state (drag position, selection), the CRDT owns
  // the truth. Re-derive flow nodes whenever either side changes.
  const applyBoardNodes = useCallback(
    (reconciled?: readonly string[]) => {
      // React Flow owns the board for the length of a marquee. Rebuilding the flow
      // nodes mid-gesture hands it a stale `selected` set and clears the box, so
      // the paint waits for the gesture to close and reconciles once, in `endMarquee`.
      if (marqueeActive.current) return;
      // Computed once per pass: an unchanged key means React Flow's live selection
      // is the truth, a changed one means a surface asked for a different set.
      const explicit = reconciled ? new Set(reconciled) : null;
      const repaintSelection = !explicit && selectedKey !== paintedSelection.current;
      if (!explicit) paintedSelection.current = selectedKey;
      setNodes((current) => {
        const byId = new Map(current.map((node) => [node.id, node]));
        // Paint order comes from the sorted board list; ranks are fractional, so
        // they cannot be used as CSS z-index values directly.
        return boardCards.flatMap((card: Card, layer) => {
          const placement = boardPlacements.get(card.id);
          if (!placement) return [];
          const existing = byId.get(card.id);
          const sectionOffset = cardOffsetsMap.get(card.id);
          const storedPosition = sectionOffset
            ? { x: placement.x + sectionOffset.dx, y: placement.y + sectionOffset.dy }
            : { x: placement.x, y: placement.y };
          const position =
            existing &&
            (locallyDraggingIds.current.has(card.id) || locallyResizing.current.has(card.id))
              ? existing.position
              : (smoothPositions.current.get(card.id) ?? storedPosition);
          const selected = explicit
            ? explicit.has(card.id)
            : repaintSelection
              ? selectedKey.split(",").includes(card.id)
              : existing?.selected === true;
          const type = resolveCardType(typeMap, card.primaryTypeId);
          const meta = metaByCard.get(card.id) ?? EMPTY_META;
          const previous = existing?.data as CardNodeData | undefined;
          // Reuse the data object (and the node when nothing visible changed), so
          // a card that did not change does not re-render on a peer's edit.
          const data: CardNodeData =
            previous &&
            previous.card === card &&
            previous.placement === placement &&
            previous.type === type &&
            previous.meta === meta
              ? previous
              : { card, placement, type, meta };
          if (
            existing &&
            existing.data === data &&
            existing.selected === selected &&
            existing.zIndex === layer &&
            existing.position.x === position.x &&
            existing.position.y === position.y
          ) {
            return [existing];
          }
          return [
            {
              id: card.id,
              type: isWhiteboardCard(card) ? "whiteboard" : isPortalCard(card) ? "portal" : "note",
              position: { x: position.x, y: position.y },
              selected,
              zIndex: layer,
              data,
            } satisfies Node,
          ];
        });
      });
    },
    [boardCards, boardPlacements, selectedKey, typeMap, metaByCard, cardOffsetsMap, setNodes],
  );

  useEffect(() => {
    applyBoardNodes();
  }, [applyBoardNodes]);

  /**
   * Releases the marquee guard on every termination path, not just the happy
   * one. React Flow reports `onSelectionEnd` when the box closes on its own; a
   * pointer released outside the pane or an Escape mid-gesture leaves the guard
   * up, and a stale guard freezes selection painting for the rest of the session.
   *
   * The final selection is React Flow's, so the store is reconciled once, here,
   * instead of on every pointer frame the box reports.
   */
  const endMarquee = useCallback(() => {
    // React Flow clears its own selection state in the pane's pointerup handler,
    // which never runs when the pointer is released outside the pane or over a
    // panel. Left set, `userSelectionActive` keeps the pane in selection mode and
    // every later marquee neither paints nor selects, which is the "the page
    // broke" half of the report. This mirrors that handler for the paths it
    // cannot see, on every termination path and whether or not the guard below
    // is still up.
    store.setState((state) =>
      state.userSelectionRect || state.userSelectionActive
        ? { userSelectionRect: null, userSelectionActive: false }
        : state,
    );
    if (!marqueeActive.current) return;
    marqueeActive.current = false;
    const ids = [...liveSelectedIds()];
    // Set before the store write, so the repaint it causes sees an unchanged key
    // and keeps the selection this pass painted.
    paintedSelection.current = ids.join(",");
    setSelectedNodeIds(ids);
    applyBoardNodes(ids);
  }, [applyBoardNodes, liveSelectedIds, setSelectedNodeIds, store]);

  // The listener effect must not re-subscribe when `endMarquee` changes: its
  // cleanup used to drop `marqueeActive`, so the first rebuild during a gesture
  // (a peer's presence tick, or the store echo of the first selection frame)
  // released the guard mid-drag. With the guard down, the store echo repainted
  // `selected` from a stale set and React Flow's own selection was overwritten.
  const endMarqueeRef = useRef(endMarquee);

  useEffect(() => {
    endMarqueeRef.current = endMarquee;
  }, [endMarquee]);

  useEffect(() => {
    const onPointerEnd = () => endMarqueeRef.current();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") endMarqueeRef.current();
    };
    // Bubble phase, so React Flow has finalised its selection on the same event.
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const next = new Map<string, { x: number; y: number }>();
    for (const peer of Object.values(peers)) {
      // A top or left resize moves the node, so its corner streams like a drag's.
      if (peer.dragging) {
        const { nodeId, position, nodeIds } = peer.dragging;
        next.set(nodeId, position);
        // A multi-drag streams the anchor only; every other member rides the
        // same delta from its stored placement, so the set moves as one piece.
        const anchorPlacement = boardPlacements.get(nodeId);
        if (nodeIds && nodeIds.length > 1 && anchorPlacement) {
          const dx = position.x - anchorPlacement.x;
          const dy = position.y - anchorPlacement.y;
          for (const id of nodeIds) {
            if (id === nodeId) continue;
            const placement = boardPlacements.get(id);
            if (!placement) continue;
            next.set(id, { x: placement.x + dx, y: placement.y + dy });
          }
        }
      } else if (peer.resizing?.position) next.set(peer.resizing.nodeId, peer.resizing.position);

      // A section drag moves its members; resolve the same plan locally so the
      // cards ease toward the peer's section instead of stepping.
      if (peer.sectionDrag) {
        const root = boardSections.find((section) => section.id === peer.sectionDrag?.sectionId);
        if (root) {
          const dx = peer.sectionDrag.position.x - root.x;
          const dy = peer.sectionDrag.position.y - root.y;
          const plan = sectionMovePlan(root.id, boardSections, boardPlacementList);
          for (const placement of plan.placements) {
            next.set(placement.cardId, {
              x: placement.x + dx,
              y: placement.y + dy,
            });
          }
        }
      }
    }
    peerTargets.current = next;

    // Drop smoothing state for gestures that ended so the CRDT value takes over.
    // The final document write can land before the gesture clears, so re-derive
    // instead of waiting for the next board change that may never come.
    let ended = false;
    for (const id of smoothPositions.current.keys()) {
      if (next.has(id)) continue;
      smoothPositions.current.delete(id);
      ended = true;
    }

    if (next.size > 0) runSmoothing();
    if (ended) applyBoardNodes();
  }, [peers, boardSections, boardPlacementList, boardPlacements, runSmoothing, applyBoardNodes]);

  useEffect(
    () => () => {
      if (smoothingFrame.current !== null) cancelAnimationFrame(smoothingFrame.current);
      if (localEaseFrame.current !== null) cancelAnimationFrame(localEaseFrame.current);
    },
    [],
  );

  // A hidden or occluded window throttles `requestAnimationFrame`, which would
  // freeze a peer's cards mid-drag until the local client writes on release.
  // Nobody can watch that animation, so land on the latest target instead.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (smoothingFrame.current === null || peerTargets.current.size === 0) return;
      if (performance.now() - lastSmoothingTick.current < 250) return;
      for (const [id, target] of peerTargets.current) smoothPositions.current.set(id, target);
      applyBoardNodes();
    }, 250);
    return () => window.clearInterval(timer);
  }, [applyBoardNodes]);

  useEffect(() => () => setSelectionBox(null), [setSelectionBox]);

  // Reveal a card or section a surface asked for. A request can land before the
  // board has rendered its nodes (switching boards rebuilds them on the next
  // snapshot pass), so card targets poll until React Flow registers the node.
  useEffect(() => {
    if (!focusTarget) return;

    if (focusTarget.boardId !== activeBoardId) {
      setActiveBoardId(focusTarget.boardId);
      return;
    }

    const reveal = (rect: Rect, padding: number) => {
      const { width, height, minZoom } = store.getState();
      // `fitBounds` cannot cap the zoom, and a single card should not fill the screen.
      const viewport = getViewportForBounds(rect, width, height, minZoom, FOCUS_MAX_ZOOM, padding);
      void setViewport(viewport, { duration: FOCUS_DURATION_MS });
    };

    if (focusTarget.kind === "section") {
      const section = snapshot.sections.find((entry) => entry.id === focusTarget.id);
      if (!section) {
        clearFocusTarget();
        return;
      }
      reveal({ x: section.x, y: section.y, width: section.width, height: section.height }, 0.12);
      clearFocusTarget();
      return;
    }

    let frame = 0;
    const deadline = performance.now() + FOCUS_POLL_TIMEOUT_MS;
    const settle = () => {
      const node = store.getState().nodeLookup.get(focusTarget.id);
      if (!node) {
        if (performance.now() > deadline) {
          clearFocusTarget();
          return;
        }
        frame = requestAnimationFrame(settle);
        return;
      }
      const position = node.internals.positionAbsolute;
      reveal(
        {
          x: position.x,
          y: position.y,
          width: node.measured.width ?? FOCUS_FALLBACK_SIZE.width,
          height: node.measured.height ?? FOCUS_FALLBACK_SIZE.height,
        },
        0.6,
      );
      clearFocusTarget();
    };
    settle();

    return () => cancelAnimationFrame(frame);
  }, [
    activeBoardId,
    clearFocusTarget,
    focusTarget,
    setActiveBoardId,
    setViewport,
    snapshot.sections,
    store,
  ]);

  const startEdgeDescription = useCallback(
    (edgeId: string, point: { x: number; y: number }) => {
      const edge = workspace.getEdge(edgeId);
      if (!edge) return;
      // The edge keeps its selection: only the inline editor is opening.
      setEdgeDescription({ edgeId, x: point.x, y: point.y, value: edge.label ?? "" });
    },
    [workspace],
  );

  const setLabelDrag = usePresenceStore((state) => state.setLabelDrag);

  /**
   * A label drag is a gesture like any other: peers see it live and it becomes
   * one structural write on release, so a slide never streams CRDT commits.
   */
  const onLabelDrag = useCallback(
    (edgeId: string, offset: number, phase: "start" | "move" | "stop") => {
      if (!canEditLayout) return;
      if (phase === "stop") {
        setLabelDrag(null);
        workspace.setEdgeLabelOffset(edgeId, offset);
        return;
      }
      setLabelDrag({ edgeId, offset });
    },
    [setLabelDrag, workspace, canEditLayout],
  );

  // Stable so the edge list keeps its identity between unrelated board renders.
  // A share without layout capability gets no label gestures at all.
  const labelHandlers = useMemo(
    () =>
      canEditLayout
        ? { onLabelDrag, onLabelEdit: startEdgeDescription }
        : ({} as Pick<EdgeDescriptionData, "onLabelDrag" | "onLabelEdit">),
    [onLabelDrag, startEdgeDescription, canEditLayout],
  );

  useEffect(() => {
    const peerByEdge = new Map<string, string>();
    for (const peer of Object.values(peers)) {
      for (const edgeId of peer.selection?.edgeIds ?? []) {
        if (!peerByEdge.has(edgeId)) peerByEdge.set(edgeId, peer.user.color);
      }
    }

    const selectedEdges = new Set(selectedEdgeIds);

    // While a peer drags one end of a link, their dashed preview replaces it.
    const reconnecting = new Set<string>();
    for (const peer of Object.values(peers)) {
      if (peer.reconnect) reconnecting.add(peer.reconnect.edgeId);
    }

    const flowEdges: Edge[] = boardEdges.map((edge) => {
      const flowEdge = toFlowEdge(
        edge,
        selectedEdges.has(edge.id),
        labelHandlers,
        peerByEdge.get(edge.id),
      );
      return reconnecting.has(edge.id) ? { ...flowEdge, hidden: true } : flowEdge;
    });
    setEdges(flowEdges);
  }, [boardEdges, peers, selectedEdgeIds, setEdges, labelHandlers]);

  // React Flow registers this handler in an effect keyed on its identity, and
  // unregisters it during the cleanup phase of every commit that re-renders this
  // board. An inline callback therefore misses any selection change that lands in
  // the same commit (the listener's own effect runs before this one re-registers),
  // so the callback has to stay stable.
  const onSelectionChanged = useCallback(
    ({ nodes: nextNodes, edges: nextEdges }: { nodes: Node[]; edges: Edge[] }) => {
      // A marquee reports every card it touches, frame by frame. Reconciling the
      // store on each echo re-renders the shell per pointer sample and
      // republishes presence mid-gesture; `endMarquee` reconciles once instead.
      if (marqueeActive.current) return;
      setSelectedNodeIds(nextNodes.map((node) => node.id));
      setSelectedEdgeIds(nextEdges.map((edge) => edge.id));
    },
    [setSelectedNodeIds, setSelectedEdgeIds],
  );

  useOnSelectionChange({ onChange: onSelectionChanged });

  // One publisher for everything a peer has selected, including the connector
  // they clicked, so no component has to reason about who else is selected.
  useEffect(() => {
    // A gesture publishes its selection once, when the box closes; the box
    // itself travels through `setSelectionBox` below.
    if (marqueeActive.current) return;
    const connector = selectedConnector
      ? { nodeId: selectedConnector.nodeId, connectorId: selectedConnector.connectorId }
      : undefined;
    const hasSelection =
      selectedSectionId !== null ||
      selectedNodeIds.length > 0 ||
      selectedEdgeIds.length > 0 ||
      connector !== undefined;

    setPresenceSelection(
      hasSelection
        ? {
            nodeIds: selectedNodeIds,
            edgeIds: selectedEdgeIds,
            ...(connector ? { connector } : {}),
            ...(selectedSectionId ? { sectionId: selectedSectionId } : {}),
          }
        : null,
    );
  }, [
    selectedConnector,
    selectedEdgeIds,
    selectedNodeIds,
    selectedSectionId,
    setPresenceSelection,
  ]);

  // React Flow owns the marquee rectangle in screen space; publish it in flow
  // coordinates so peers draw the same gesture in the dragger's colour.
  const selectionRect = useStore((state) => state.userSelectionRect);
  const lastBoxSent = useRef(0);
  useEffect(() => {
    if (!selectionRect) {
      setSelectionBox(null);
      return;
    }
    const now = performance.now();
    if (now - lastBoxSent.current < DRAG_THROTTLE_MS) return;
    lastBoxSent.current = now;
    const start = screenToFlowPosition({ x: selectionRect.x, y: selectionRect.y });
    const end = screenToFlowPosition({
      x: selectionRect.x + selectionRect.width,
      y: selectionRect.y + selectionRect.height,
    });
    setSelectionBox({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    });
  }, [selectionRect, screenToFlowPosition, setSelectionBox]);

  const unplaceSelected = useCallback(() => {
    const state = useUiStore.getState();
    if (!canEditLayout || !activeBoardId) return;
    for (const id of state.selectedNodeIds) {
      workspace.unplaceCard(activeBoardId, id);
    }
    state.setSelectedNodeIds([]);
    state.stopEditing();
  }, [workspace, activeBoardId, canEditLayout]);

  const trashSelected = useCallback(() => {
    const state = useUiStore.getState();
    if (!canManageTrash) return;
    for (const id of state.selectedNodeIds) {
      workspace.trashCard(id);
    }
    state.setSelectedNodeIds([]);
    state.stopEditing();
  }, [workspace, canManageTrash]);

  // Selection elevates a card in React Flow, which would hide the new order, so
  // drop the selection once an explicit layer change lands.
  const changeLayer = useCallback(
    (nodeId: string, action: LayerAction) => {
      if (!canEditLayout || !activeBoardId) return;
      workspace.moveLayer(activeBoardId, nodeId, action);
      setSelectedNodeIds([]);
      setPresenceSelection(null);
    },
    [workspace, activeBoardId, setSelectedNodeIds, setPresenceSelection, canEditLayout],
  );

  // A bulk layer change is N single-card moves applied in an order that keeps
  // the selection's relative stacking (see `layerActions`).
  const changeLayerBulk = useCallback(
    (ids: string[], action: LayerAction) => {
      if (!canEditLayout || !activeBoardId) return;
      for (const id of layerActions(orderedSelection(boardOrder, ids), action)) {
        workspace.moveLayer(activeBoardId, id, action);
      }
      store.getState().unselectNodesAndEdges();
      setSelectedNodeIds([]);
      setPresenceSelection(null);
    },
    [
      workspace,
      activeBoardId,
      boardOrder,
      setSelectedNodeIds,
      setPresenceSelection,
      store,
      canEditLayout,
    ],
  );

  const handleSelectSection = useCallback(
    (sectionId: string | null) => {
      if (sectionId) store.getState().unselectNodesAndEdges();
      selectSection(sectionId);
    },
    [selectSection, store],
  );

  const publishSectionDrag = useCallback(
    (sectionId: string, position: { x: number; y: number }) => {
      const now = performance.now();
      if (now - lastSectionPublish.current < DRAG_THROTTLE_MS) return;
      lastSectionPublish.current = now;
      setSectionDragPresence({ sectionId, position });
    },
    [setSectionDragPresence],
  );

  const handleSectionDrag = useCallback(
    (sectionId: string, position: { x: number; y: number }) => {
      setLocalSectionDrag({ sectionId, position });
      publishSectionDrag(sectionId, position);
    },
    [publishSectionDrag],
  );

  const handleSectionDragEnd = useCallback(
    (sectionId: string, position: { x: number; y: number }) => {
      if (!canEditLayout) return;
      const root = boardSections.find((section) => section.id === sectionId);
      if (root) {
        const dx = position.x - root.x;
        const dy = position.y - root.y;
        if (dx !== 0 || dy !== 0) {
          const plan = sectionMovePlan(sectionId, boardSections, boardPlacementList);
          workspace.moveSectionsBatch({
            sections: plan.sections.map((section) => ({
              id: section.id,
              x: section.x + dx,
              y: section.y + dy,
            })),
            placements: plan.placements.map((placement) => ({
              boardId: placement.boardId,
              cardId: placement.cardId,
              x: placement.x + dx,
              y: placement.y + dy,
            })),
          });
        }
      }
      setLocalSectionDrag(null);
      setSectionDragPresence(null);
    },
    [boardSections, boardPlacementList, workspace, setSectionDragPresence, canEditLayout],
  );

  const handleSectionResize = useCallback(
    (sectionId: string, rect: Rect) => {
      setLocalSectionResize({ sectionId, rect });
      const now = performance.now();
      if (now - lastSectionPublish.current < DRAG_THROTTLE_MS) return;
      lastSectionPublish.current = now;
      setSectionResizePresence({
        sectionId,
        position: { x: rect.x, y: rect.y },
        width: rect.width,
        height: rect.height,
      });
    },
    [setSectionResizePresence],
  );

  const handleSectionResizeEnd = useCallback(
    (sectionId: string, rect: Rect) => {
      if (!canEditLayout) return;
      workspace.updateSectionGeometry(sectionId, rect);
      setLocalSectionResize(null);
      setSectionResizePresence(null);
    },
    [workspace, setSectionResizePresence, canEditLayout],
  );

  const handleSectionRename = useCallback(
    (sectionId: string, title: string) => {
      if (!canEditLayout) {
        setEditingSection(null);
        return;
      }
      workspace.renameSection(sectionId, title.trim());
      setEditingSection(null);
    },
    [workspace, setEditingSection, canEditLayout],
  );

  const createSectionAt = useCallback(
    (position: { x: number; y: number }, wrapSelection = false) => {
      if (!canCreateContent || !activeBoardId) return;
      const selected = useUiStore.getState().selectedNodeIds;
      let rect: Rect = { x: position.x, y: position.y, width: 360, height: 260 };

      if (wrapSelection && selected.length > 0) {
        const lookup = store.getState().nodeLookup;
        const cardRects = selected.flatMap((id) => {
          const node = lookup.get(id);
          if (!node) return [];
          const width = node.measured?.width ?? node.width ?? 224;
          const height = node.measured?.height ?? node.height ?? 160;
          return [{ x: node.position.x, y: node.position.y, width, height }];
        });
        const first = cardRects[0];
        if (first) {
          const union = unionRect(first, cardRects.slice(1), 24);
          rect = {
            x: union.x,
            y: union.y - 16,
            width: union.width,
            height: union.height + 16,
          };
        }
      }

      const section = workspace.createSection({ boardId: activeBoardId, ...rect });
      store.getState().unselectNodesAndEdges();
      selectSection(section.id);
      setEditingSection(section.id);
    },
    [activeBoardId, store, workspace, selectSection, setEditingSection, canCreateContent],
  );

  /**
   * Commits a finished drag of one or more cards. The move and any section
   * growth land in one document commit (and so one undo step): `moveSectionsBatch`
   * accepts placements, so a drop that grows a section does not need a second
   * write the way a separate `movePlacements` call would.
   */
  const commitDrop = useCallback(
    (dragged: Node[]) => {
      if (!canEditLayout || !activeBoardId || dragged.length === 0) return;
      const moves = dragMoves(dragged);
      const plan = sectionsExpandPlan(boardSections, dragRects(dragged));
      if (plan.length > 0) {
        workspace.moveSectionsBatch({
          sections: plan,
          placements: moves.map((move) => ({ boardId: activeBoardId, ...move })),
        });
        return;
      }
      // No section needs to grow: `movePlacements` skips no-op moves and stays
      // silent when the whole gesture ended where it started.
      workspace.movePlacements(activeBoardId, moves);
    },
    [activeBoardId, boardSections, workspace, canEditLayout],
  );

  const createNoteAt = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent || !activeBoardId) return;
      const card = workspace.createCard({ boardId: activeBoardId, position });
      setSelectedNodeIds([card.id]);
      startEditing(card.id, "title");
    },
    [workspace, activeBoardId, setSelectedNodeIds, startEditing, canCreateContent],
  );

  const createWhiteboardAt = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent || !activeBoardId) return;
      const type = ensureWhiteboardType(workspace);
      const card = workspace.createCard({ typeId: type.id, boardId: activeBoardId, position });
      setSelectedNodeIds([card.id]);
      openCardFocus(card.id);
    },
    [workspace, activeBoardId, setSelectedNodeIds, canCreateContent, openCardFocus],
  );

  /**
   * A portal is created with its target in one commit (`createPortalCard`), so
   * the new card can never be seen — or undo-stepped into — without a board.
   */
  const createPortalAt = useCallback(
    (position: { x: number; y: number }, targetBoardId: string) => {
      if (!canCreateContent || !activeBoardId) return;
      const card = workspace.createPortalCard({
        boardId: activeBoardId,
        targetBoardId,
        position,
        // Shaped like the board it opens, measured from the same snapshot the
        // miniature draws from, so the card and its picture agree.
        size: portalSizeForBounds(
          boardBounds(
            snapshot.sections.filter((section) => section.boardId === targetBoardId),
            snapshot.placements.filter((placement) => placement.boardId === targetBoardId),
          ),
        ),
      });
      store.getState().unselectNodesAndEdges();
      store.getState().addSelectedNodes([card.id]);
      setSelectedNodeIds([card.id]);
    },
    [workspace, activeBoardId, setSelectedNodeIds, store, canCreateContent, snapshot],
  );

  /** "New board and portal": stay here and open the new board from the card. */
  const createPortalToNewBoard = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent || !canCreateBoards || !activeBoardId) return;
      const board = workspace.createBoard();
      createPortalAt(position, board.id);
    },
    [workspace, createPortalAt, activeBoardId, canCreateContent, canCreateBoards],
  );

  /** Screen rectangle of a node, used to start the camera trick at the card. */
  const nodeScreenRect = useCallback(
    (nodeId: string) => {
      const node = store.getState().nodeLookup.get(nodeId);
      const pane = document.querySelector<HTMLElement>('[data-testid="canvas-board"]');
      if (!node || !pane) return null;
      const rect = pane.getBoundingClientRect();
      const [tx, ty, zoom] = store.getState().transform;
      const position = node.internals.positionAbsolute;
      const width = node.measured?.width ?? FOCUS_FALLBACK_SIZE.width;
      const height = node.measured?.height ?? FOCUS_FALLBACK_SIZE.height;
      return {
        left: rect.left + position.x * zoom + tx,
        top: rect.top + position.y * zoom + ty,
        width: width * zoom,
        height: height * zoom,
      };
    },
    [store],
  );

  const enterPortal = useCallback(
    (nodeId: string, targetBoardId: string) => {
      const rect = nodeScreenRect(nodeId);
      if (!rect) return;
      requestPortalEntry({ nodeId, targetBoardId, rect });
    },
    [nodeScreenRect, requestPortalEntry],
  );

  /** Orderly arrival on a board whose stored camera should be restored. */
  useEffect(() => {
    if (!viewportRequest || viewportRequest.boardId !== activeBoardId) return;
    const request = viewportRequest;
    // The board's nodes paint on the render this effect follows; one frame
    // later React Flow has the size it needs to fit them. The request is
    // cleared after the move, not before: clearing re-renders, and a cleanup
    // on that render would cancel the frame this effect just scheduled.
    const frame = requestAnimationFrame(() => {
      if (request.viewport) {
        void setViewport(request.viewport, { duration: 0 });
      } else {
        void fitView({ padding: 0.2, duration: 0 });
      }
      clearViewportRequest();
    });
    return () => cancelAnimationFrame(frame);
  }, [viewportRequest, activeBoardId, clearViewportRequest, setViewport, fitView]);

  useEffect(() => {
    if (!activeBoardId) return;
    // Capture the camera a board opens with (the first visit's fit-view), so a
    // return is exact even if the reader never panned on it.
    const frame = requestAnimationFrame(() => {
      recordBoardViewport(activeBoardId, getViewport());
    });
    return () => cancelAnimationFrame(frame);
  }, [activeBoardId, recordBoardViewport, getViewport]);

  const lastMoveZoom = useRef<number | null>(null);
  /** Zoom a pan/zoom gesture started at; reverse zoom compares against it. */
  const gestureStartZoom = useRef<number | null>(null);
  /** Portals already entered by zooming, so a lingering overview does not re-enter. */
  const autoEntered = useRef(new Set<string>());
  /** The board the zoom-entry guards belong to. */
  const autoEnteredBoard = useRef<string | null>(null);
  useEffect(() => {
    if (autoEnteredBoard.current === activeBoardId) return;
    autoEnteredBoard.current = activeBoardId;
    autoEntered.current.clear();
    lastMoveZoom.current = null;
  }, [activeBoardId]);

  /**
   * Two camera gestures end a board visit: zooming until a portal fills most of
   * the canvas enters it, and zooming far back out of a board entered through a
   * portal returns to the one before it. Both are read at the end of the
   * gesture, so neither reacts per frame.
   */
  const readCameraGesture = useCallback(
    (startZoom: number, zoom: number) => {
      const history = useUiStore.getState().boardHistory;
      const previousMove = lastMoveZoom.current;
      lastMoveZoom.current = zoom;

      // Reverse zoom: only a portal visit advertised itself as a doorway, and
      // only a deliberate pull-back (half the gesture's starting scale) counts.
      if (
        startZoom > 0 &&
        zoom <= startZoom * PORTAL_ZOOM_BACK_RATIO &&
        zoom < 0.6 &&
        history.at(-1)?.via === "portal"
      ) {
        goBackBoard();
        return;
      }

      // Entering needs an inward gesture; a fit-view or a tab switch must not
      // drop the reader into whichever portal happens to be on screen.
      if (previousMove === null || zoom <= previousMove * 1.02) return;
      const pane = document.querySelector<HTMLElement>('[data-testid="canvas-board"]');
      if (!pane) return;
      const paneRect = pane.getBoundingClientRect();
      if (paneRect.width === 0 || paneRect.height === 0) return;
      const paneArea = paneRect.width * paneRect.height;

      for (const [id, node] of store.getState().nodeLookup) {
        if (autoEntered.current.has(id)) continue;
        const targetBoardId = portalTargetId(cardsById.get(id));
        if (!targetBoardId) continue;
        const position = node.internals.positionAbsolute;
        const rect = nodeScreenRect(id);
        if (!rect) continue;
        const overlapWidth =
          Math.min(rect.left + rect.width, paneRect.right) - Math.max(rect.left, paneRect.left);
        const overlapHeight =
          Math.min(rect.top + rect.height, paneRect.bottom) - Math.max(rect.top, paneRect.top);
        if (overlapWidth <= 0 || overlapHeight <= 0) continue;
        if ((overlapWidth * overlapHeight) / paneArea < PORTAL_ZOOM_COVERAGE) continue;
        // `position` is read so a node without geometry is skipped rather than
        // measured at the origin, which would read as a full-canvas portal.
        if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
        autoEntered.current.add(id);
        enterPortal(id, targetBoardId);
        return;
      }
    },
    [store, cardsById, nodeScreenRect, enterPortal, goBackBoard],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      const state = useUiStore.getState();

      // Quick capture: Cmd/Ctrl+Enter adds a card at the viewport centre and
      // opens its title. A text surface keeps the browser's own chord, so the
      // shortcut never steals a key inside an editor body or a field.
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        !isTyping &&
        !(target instanceof HTMLElement && target.closest(".ProseMirror"))
      ) {
        if (!canCreateContent || !activeBoardId) return;
        event.preventDefault();
        const centre = screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
        // Place the card's centre, not its top-left corner, under the cursor.
        createNoteAt({
          x: centre.x - DEFAULT_CARD_WIDTH / 2,
          y: centre.y - DEFAULT_CARD_HEIGHT / 2,
        });
        return;
      }

      if (event.key === "Escape" && state.editingSectionId) {
        state.setEditingSection(null);
        return;
      }

      if (event.key === "Escape" && state.selectedSectionId) {
        state.selectSection(null);
        return;
      }

      // Focus is a mode of its own: Escape leaves it (and stops its editing)
      // before the card-level or selection-level branches see the key.
      if (event.key === "Escape" && state.cardFocusId) {
        state.closeCardFocus();
        return;
      }

      if (event.key === "Escape" && state.editingNodeId) {
        state.stopEditing();
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      if (event.key === "Escape" && state.focusTarget) {
        state.clearFocusTarget();
        return;
      }

      // A board entered through a portal is a doorway: Escape steps back to the
      // exact board and viewport it was entered from.
      if (event.key === "Escape" && state.boardHistory.at(-1)?.via === "portal") {
        goBackBoard();
        return;
      }

      // Last of the Escape branches: drop the selection once nothing more
      // specific (a rename, an editing card, a pending reveal) owns Escape.
      if (
        event.key === "Escape" &&
        (state.selectedNodeIds.length > 0 ||
          state.selectedEdgeIds.length > 0 ||
          state.selectedConnector)
      ) {
        store.getState().unselectNodesAndEdges();
        state.setSelectedNodeIds([]);
        state.setSelectedEdgeIds([]);
        state.setSelectedConnector(null);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !isTyping) {
        const key = event.key.toLowerCase();
        // Inside a card the editor owns undo (per-fragment history); here it
        // covers structure: moves, links, connectors, place and trash.
        if (key === "z" || key === "y") {
          event.preventDefault();
          if (!canEditContent && !canEditLayout) return;
          if (key === "z" && !event.shiftKey) workspace.undo();
          else workspace.redo();
          state.setSelectedNodeIds([]);
          state.stopEditing();
          return;
        }

        if (key === "g" && canCreateContent) {
          event.preventDefault();
          const centre = screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
          createSectionAt({ x: centre.x - 180, y: centre.y - 130 }, true);
          return;
        }

        // Select every card on the board, never the page text.
        if (key === "a" && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          const ids = boardCardIds.current;
          const flow = store.getState();
          flow.unselectNodesAndEdges();
          flow.addSelectedNodes(ids);
          state.selectAllOnBoard(ids);
          return;
        }
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (isTyping) return;
        if (state.selectedSectionId) {
          // Sections are workspace structure: an editor may change them, not delete them.
          if (!canManageStructure) return;
          event.preventDefault();
          workspace.deleteSection(state.selectedSectionId);
          state.selectSection(null);
          return;
        }
        if (state.selectedNodeIds.length === 0) return;
        if (!canManageTrash && !canEditLayout) return;
        event.preventDefault();
        // Shift is the explicit trash gesture and stays owner-only. A share
        // editor's Delete unplaces, which is the only destructive act it owns.
        if (event.shiftKey && canManageTrash) trashSelected();
        else if (canEditLayout) unplaceSelected();
        return;
      }

      if (event.key === "Enter" && !isTyping && !state.editingNodeId) {
        const first = state.selectedNodeIds[0];
        if (!first) return;
        // A selected portal is a doorway even for a viewer: navigating is not
        // an edit. Any other card opens its body editor.
        const targetBoardId = portalTargetId(cardsById.get(first));
        if (targetBoardId) {
          event.preventDefault();
          enterPortal(first, targetBoardId);
          return;
        }
        if (!canEditContent) return;
        event.preventDefault();
        state.startEditing(first, "body");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    trashSelected,
    unplaceSelected,
    workspace,
    createSectionAt,
    createNoteAt,
    screenToFlowPosition,
    store,
    activeBoardId,
    canCreateContent,
    canEditContent,
    canEditLayout,
    canManageTrash,
    canManageStructure,
    goBackBoard,
    enterPortal,
    cardsById,
  ]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!canCreateContent) return;
      if (!connection.source || !connection.target) return;
      if (!activeBoardId) return;
      workspace.addEdge({
        boardId: activeBoardId,
        source: connection.source,
        target: connection.target,
        ...(connection.sourceHandle ? { sourceConnector: connection.sourceHandle } : {}),
        ...(connection.targetHandle ? { targetConnector: connection.targetHandle } : {}),
      });
    },
    [workspace, activeBoardId, canCreateContent],
  );

  // React Flow reports nothing while a reconnect drag moves, so follow the
  // pointer ourselves and publish the endpoint for peers to preview.
  useEffect(() => {
    if (!reconnecting) return;

    let frame: number | null = null;
    let cancelled = false;
    const publish = (position: { x: number; y: number }) => {
      if (frame !== null) cancelAnimationFrame(frame);
      // React Flow updates `connection` after the pointer event, so read it on
      // the next frame; otherwise a sample that lands on a connector can keep
      // the previous, unsnapped target.
      frame = requestAnimationFrame(() => {
        frame = null;
        if (cancelled) return;
        const { connection } = store.getState();
        const snapped = connection.isValid
          ? [connection.toHandle, connection.fromHandle].find(
              (handle) => handle && handle.id !== reconnecting.anchorConnector,
            )
          : undefined;

        setReconnect({
          edgeId: reconnecting.edgeId,
          end: reconnecting.end,
          position,
          ...(snapped?.nodeId && snapped.id
            ? { target: { nodeId: snapped.nodeId, connectorId: snapped.id } }
            : {}),
        });
      });
    };
    const { follow, stop } = followPointer(screenToFlowPosition, publish);

    window.addEventListener("pointermove", follow);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", follow);
      // The drop already rewrote the edge, so never re-publish here: onReconnectEnd
      // clears the field first and a late sample would resurrect the preview.
      stop();
    };
  }, [reconnecting, screenToFlowPosition, setReconnect, store]);

  // A new link has no edge to follow yet, so its live pointer rides awareness
  // the same way a reconnect drag's does.
  useEffect(() => {
    if (!connecting) return;

    let frame: number | null = null;
    let cancelled = false;
    const publish = (position: { x: number; y: number }) => {
      if (frame !== null) cancelAnimationFrame(frame);
      // Forward React Flow's own snap decision rather than re-testing radii.
      // Read it after React Flow processes the pointer event.
      frame = requestAnimationFrame(() => {
        frame = null;
        if (cancelled) return;
        const { connection } = store.getState();
        const snapped = connection.isValid
          ? [connection.toHandle, connection.fromHandle].find(
              (handle) =>
                handle &&
                handle.id !== connecting.connectorId &&
                handle.nodeId !== connecting.nodeId,
            )
          : undefined;

        setConnect({
          nodeId: connecting.nodeId,
          connectorId: connecting.connectorId,
          anchorEnd: connecting.anchorEnd,
          position,
          ...(snapped?.nodeId && snapped.id
            ? { target: { nodeId: snapped.nodeId, connectorId: snapped.id } }
            : {}),
        });
      });
    };
    const { follow, stop } = followPointer(screenToFlowPosition, publish);

    window.addEventListener("pointermove", follow);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", follow);
      // onConnectEnd clears the field first; a late sample must not revive it.
      stop();
    };
  }, [connecting, screenToFlowPosition, setConnect, store]);

  const onConnectStart = useCallback<OnConnectStart>(
    (event, params) => {
      if (!canCreateContent) return;
      // Edge updaters report their anchored handle here as well; that gesture
      // publishes `reconnect` and has its own preview.
      if (reconnectGesture.current) return;

      const { nodeId, handleId, handleType } = params;
      if (!nodeId || !handleId) return;

      const anchorEnd = handleType === "target" ? "target" : "source";
      // Two link gestures never overlap, so the reconnect preview goes first.
      setReconnecting(null);
      setReconnect(null);
      setConnecting({ nodeId, connectorId: handleId, anchorEnd });

      const point = clientPoint(event);
      if (!point) return;
      setConnect({
        nodeId,
        connectorId: handleId,
        anchorEnd,
        position: screenToFlowPosition(point),
      });
    },
    [screenToFlowPosition, setConnect, setReconnect, canCreateContent],
  );

  const onConnectEnd = useCallback<OnConnectEnd>(() => {
    setConnecting(null);
    setConnect(null);
  }, [setConnect]);

  const onReconnectStart = useCallback(
    (event: React.MouseEvent, edge: Edge, handleType: HandleType) => {
      if (!canEditLayout) return;
      // React Flow also fires onConnectStart for this drag; mark it so the
      // new-link presence stays out of it.
      reconnectGesture.current = true;
      setConnecting(null);
      setConnect(null);
      // React Flow reports the handle that stays anchored, so the other end moves.
      const end: HandleType = handleType === "source" ? "target" : "source";
      setReconnecting({
        edgeId: edge.id,
        end,
        anchorConnector: (handleType === "source" ? edge.sourceHandle : edge.targetHandle) ?? null,
      });
      setReconnect({
        edgeId: edge.id,
        end,
        position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [screenToFlowPosition, setReconnect, setConnect, canEditLayout],
  );

  const onReconnectStop = useCallback(() => {
    reconnectGesture.current = false;
    setReconnecting(null);
    setReconnect(null);
  }, [setReconnect]);

  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      if (!canEditLayout) return;
      if (!connection.source || !connection.target) return;
      // React Flow keeps the anchored end intact, so an unchanged source means the target moved.
      const end: "source" | "target" =
        connection.source === oldEdge.source && connection.sourceHandle === oldEdge.sourceHandle
          ? "target"
          : "source";
      const nodeId = end === "source" ? connection.source : connection.target;
      const connectorId = end === "source" ? connection.sourceHandle : connection.targetHandle;
      workspace.reconnectEdge(oldEdge.id, end, nodeId, connectorId ?? undefined);
    },
    [workspace, canEditLayout],
  );

  /**
   * Copies cards onto the active board. Each copy steps a little further out so
   * a batch does not stack on one spot, and the copies become the selection.
   */
  const duplicateCards = useCallback(
    (ids: string[]) => {
      if (!canCreateContent || !activeBoardId || ids.length === 0) return;
      const copies = ids.flatMap((id, index) => {
        const card = workspace.getCard(id);
        if (!card || card.deletedAt) return [];
        const step = 16 * index;
        return [
          workspace.duplicateCard(id, {
            boardId: activeBoardId,
            offset: { x: 24 + step, y: 24 + step },
          }),
        ];
      });
      if (copies.length === 0) return;
      setSelectedNodeIds(copies.map((copy) => copy.id));
      setPresenceSelection(null);
    },
    [workspace, activeBoardId, canCreateContent, setSelectedNodeIds, setPresenceSelection],
  );

  const moveCardToBoard = useCallback(
    (cardId: string, boardId: string) => {
      if (!canEditLayout) return;
      workspace.moveCardToBoard(cardId, boardId);
      setSelectedNodeIds([]);
      stopEditing();
    },
    [workspace, canEditLayout, setSelectedNodeIds, stopEditing],
  );

  const commitEdgeDescription = useCallback(
    (value: string) => {
      if (!edgeDescription) return;
      // Empty text removes the description rather than storing a blank one.
      workspace.setEdgeLabel(edgeDescription.edgeId, value.trim() ? value : null);
      setEdgeDescription(null);
    },
    [workspace, edgeDescription],
  );

  const cancelEdgeDescription = useCallback(() => setEdgeDescription(null), []);

  // React Flow keeps its own node selection, so the menu mirrors a selection
  // into it after the store write and highlighting follows.
  const selectNodesInFlow = useCallback(
    (ids: string[]) => {
      store.getState().addSelectedNodes(ids);
    },
    [store],
  );

  // One menu for every canvas surface: the builder lives in a hook so the
  // scene renderer can open the exact same items.
  const menuItems = useCanvasMenuItems({
    contextMenu,
    workspace,
    snapshot,
    activeBoardId,
    selectedNodeIds,
    sectionMembershipMap,
    setSelectedNodeIds,
    setSelectedConnector,
    selectSection,
    setEditingSection,
    canCreateContent,
    canCreateBoards,
    canEditContent,
    canEditLayout,
    canManageStructure,
    canManageTrash,
    canManageLinks,
    createNoteAt,
    createWhiteboardAt,
    createSectionAt,
    createPortalAt,
    createPortalToNewBoard,
    duplicateCards,
    startEdgeDescription,
    enterPortal,
    moveCardToBoard,
    unplaceSelected,
    trashSelected,
    changeLayer,
    changeLayerBulk,
    requestShare,
    syncCardSelection: selectNodesInFlow,
  });

  return (
    <div
      data-testid="canvas-board"
      className={`h-full w-full ${selectedConnector ? "connector-active" : ""}`}
      onPointerMove={(event) => {
        const now = performance.now();
        if (now - lastPointerSent.current < POINTER_THROTTLE_MS) return;
        lastPointerSent.current = now;
        setPointer(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      }}
      onPointerLeave={() => setPointer(null)}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={canvasNodeTypes}
        edgeTypes={edgeTypes}
        // Unmount nodes and edges outside the viewport. React Flow keeps measured
        // sizes and handle bounds for unmounted nodes, so edges still route and
        // connectors remeasure when a card scrolls back in.
        onlyRenderVisibleElements
        fitView
        deleteKeyCode={null}
        // Selection, panning, zoom and the inspector stay for every role.
        // Layout writes follow the session capabilities: an editor share may
        // move and reconnect what exists, but never draw a new link.
        nodesDraggable={canEditLayout}
        nodesConnectable={canCreateContent}
        edgesReconnectable={canEditLayout}
        // Shift, Ctrl and Cmd all toggle membership; Shift also starts the
        // marquee (React Flow's `selectionKeyCode` default). `Partial` selects a
        // card the box merely touches, which is what a card board should do.
        multiSelectionKeyCode={["Meta", "Control", "Shift"]}
        selectionMode={SelectionMode.Partial}
        onSelectionStart={() => {
          marqueeActive.current = true;
        }}
        onSelectionEnd={() => {
          // React Flow's final selection is authoritative; `endMarquee` releases
          // the guard and reconciles the store with it.
          endMarquee();
        }}
        connectionMode={ConnectionMode.Loose}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectStop}
        onEdgeContextMenu={(event, edge) => {
          if (!canEditLayout) return;
          event.preventDefault();
          openContextMenu({ x: event.clientX, y: event.clientY, kind: "edge", edgeId: edge.id });
        }}
        onEdgeClick={() => setSelectedConnector(null)}
        onNodeDoubleClick={(event, node) => {
          // A portal is a doorway: the camera transition replaces the board in
          // place. Any other card opens the full-canvas focus surface.
          const targetBoardId = portalTargetId(cardsById.get(node.id));
          if (targetBoardId) {
            event.preventDefault();
            enterPortal(node.id, targetBoardId);
            return;
          }
          openCardFocus(node.id);
        }}
        onMoveStart={(_event, viewport) => {
          gestureStartZoom.current = viewport.zoom;
        }}
        onMoveEnd={(_event, viewport) => {
          if (activeBoardId) recordBoardViewport(activeBoardId, viewport);
          readCameraGesture(gestureStartZoom.current ?? viewport.zoom, viewport.zoom);
        }}
        onEdgeDoubleClick={(event, edge) => {
          if (!canEditLayout) return;
          event.preventDefault();
          startEdgeDescription(edge.id, { x: event.clientX, y: event.clientY });
        }}
        onNodeDragStart={(_, node, dragged) => {
          if (!canEditLayout) return;
          // React Flow drags the whole selection; the node under the pointer is
          // the anchor peers derive every other member's position from.
          const ids = dragged.length > 0 ? dragged.map((entry) => entry.id) : [node.id];
          draggedNodeIds.current = ids;
          locallyDraggingIds.current = new Set(ids);
          // The rendered delta is eased from here to drop. Reduced motion keeps
          // the pre-A10 behaviour: paint the pointer sample directly.
          if (prefersReducedMotion()) stopLocalEase();
          else {
            const ease = new LocalDragEase();
            ease.begin(
              (dragged.length > 0 ? dragged : [node]).map((entry) => ({
                id: entry.id,
                position: entry.position,
              })),
              performance.now(),
            );
            localEase.current = ease;
          }
          setDragging({ nodeId: node.id, position: node.position, nodeIds: ids });
        }}
        onNodeDrag={(_, node) => {
          if (!canEditLayout) return;
          localEase.current?.target(node.id, node.position);
          if (localEase.current) runLocalEase();
          const now = performance.now();
          if (now - lastDragSent.current < DRAG_THROTTLE_MS) return;
          lastDragSent.current = now;
          setDragging({
            nodeId: node.id,
            position: node.position,
            nodeIds: draggedNodeIds.current,
          });
        }}
        onNodeDragStop={(_, node, dragged) => {
          if (!canEditLayout) return;
          const dropped = dragged.length > 0 ? dragged : [node];
          // The pointer position is the truth: land the render on it and paint
          // it before the one commit, so the drop never lingers a frame behind.
          const droppedAt = localEase.current?.finish();
          stopLocalEase();
          if (droppedAt && droppedAt.size > 0) {
            setNodes((current) =>
              current.map((entry) => {
                const position = droppedAt.get(entry.id);
                return position ? { ...entry, position, dragging: false } : entry;
              }),
            );
          }
          draggedNodeIds.current = [];
          locallyDraggingIds.current = new Set();
          setDragging(null);
          commitDrop(dropped);
        }}
        onPaneClick={() => {
          setSelectedConnector(null);
          handleSelectSection(null);
        }}
        onNodeClick={() => {
          setSelectedConnector(null);
          handleSelectSection(null);
        }}
        onNodeContextMenu={(event, node) => {
          if (!canEditContent && !canEditLayout && !canManageTrash && !canManageStructure) return;
          // Rich text keeps the browser's own menu (copy, paste, spelling).
          // Chips inside the editor stop propagation before this handler.
          if (isEditorTarget(event)) return;
          event.preventDefault();
          openContextMenu({
            x: event.clientX,
            y: event.clientY,
            kind: "node",
            nodeId: node.id,
            // Lets "New section from N cards" fall back to the card it was
            // opened on when no card is selected.
            flowPosition: node.position,
          });
        }}
        onPaneContextMenu={(event) => {
          if (!canCreateContent) return;
          event.preventDefault();
          const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          openContextMenu({ x: event.clientX, y: event.clientY, kind: "canvas", flowPosition });
        }}
        // A marquee leaves React Flow's selection overlay over the cards, so a
        // right-click there reaches this handler rather than the card's.
        onSelectionContextMenu={(event, selected) => {
          if (
            (!canEditContent && !canEditLayout && !canManageTrash && !canManageStructure) ||
            isEditorTarget(event)
          ) {
            return;
          }
          event.preventDefault();
          const anchor = selected[0];
          if (!anchor) return;
          openContextMenu({
            x: event.clientX,
            y: event.clientY,
            kind: "node",
            nodeId: anchor.id,
            flowPosition: anchor.position,
          });
        }}
      >
        <SectionLayer
          sections={boardSections}
          membership={sectionMembershipMap}
          offsets={sectionOffsetsMap}
          resizes={sectionResizes}
          peers={peers}
          selectedSectionId={selectedSectionId}
          editingSectionId={editingSectionId}
          onSelect={handleSelectSection}
          onStartRename={setEditingSection}
          onCommitRename={handleSectionRename}
          onCancelRename={() => setEditingSection(null)}
          onDrag={handleSectionDrag}
          onDragEnd={handleSectionDragEnd}
          onResize={handleSectionResize}
          onResizeEnd={handleSectionResizeEnd}
          readOnly={!canEditLayout}
          onContextMenu={(event, sectionId) => {
            if (!canEditLayout) return;
            event.preventDefault();
            openContextMenu({
              x: event.clientX,
              y: event.clientY,
              kind: "section",
              sectionId,
            });
          }}
        />
        <Background color="var(--rf-dot)" />
        <Controls showInteractive={false} />
        <PresenceLayer />
        <PeerReconnectLayer />
      </ReactFlow>
      <PortalTransitionLayer />
      {edgeDescription ? (
        <EdgeDescriptionInput
          key={edgeDescription.edgeId}
          x={edgeDescription.x}
          y={edgeDescription.y}
          value={edgeDescription.value}
          onCommit={commitEdgeDescription}
          onCancel={cancelEdgeDescription}
        />
      ) : null}
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={closeContextMenu}
        />
      ) : null}
    </div>
  );
}
