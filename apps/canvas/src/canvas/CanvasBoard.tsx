import type { Card, EdgeEndpointKind, GraphEdge, LayerAction, Placement, Rect } from "@suite/graph";
import {
  edgeEndpoints,
  sectionColors,
  sectionMembership,
  sectionMovePlan,
  unionRect,
} from "@suite/graph";
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
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CardMeta, cardMeta } from "../cards/cardMeta";
import { resolveCardType, typesById } from "../cards/cardTypes";
import { isPortalCard, portalTargetId } from "../cards/portal";
import { ensureWhiteboardType, isWhiteboardCard } from "../cards/whiteboard";
import type { ConnectState } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { markBoot, measureBoot } from "../dev/bootTiming";
import { countRender } from "../dev/perf";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { type EdgeDescriptionData, EdgeDescriptionInput, edgeTypes } from "./EdgeDescription";
import { LinkModeControl } from "./LinkModeControl";
import {
  connectorAtPoint,
  endpointAnchor,
  endpointAtPoint,
  type LinkAnchor,
  type LinkEndpointRef,
  type LinkScene,
  linkAnchors,
} from "./linkGeometry";
import { linkEndConnector } from "./linkGesture";
import { useLinkThreadStore } from "./linkThread";
import { LocalDragEase, prefersReducedMotion } from "./localEasing";
import {
  DEFAULT_CARD_HEIGHT,
  DEFAULT_CARD_WIDTH,
  dragMoves,
  dragRects,
  layerActions,
  orderedSelection,
  selectionSummary,
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
import { useCanvasLens, useLensReferenceRepair } from "./useCanvasLens";
import { useConnectorRevealState, useLinkDraftStore } from "./useNodeConnectorWiring";
import { WhiteboardNode } from "./WhiteboardNode";

/** Share of the remaining distance covered per frame when easing toward a peer's drag. */
const SMOOTHING = 0.22;
/** Screen-pixel radius that counts as a release on a connector dot. */
const CONNECTOR_DROP_RADIUS = 14;
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
  /** React Flow node ids both ends are drawn through (a portal stands in for a board). */
  link: { source: string; target: string },
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
    source: link.source,
    target: link.target,
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

/** A link drawn in flow space because one of its ends is a section. */
interface SectionLink {
  edge: GraphEdge;
  anchors: { source: LinkAnchor; target: LinkAnchor };
  offLens: boolean;
}

/**
 * The next link in a thread, rubber-banding from the armed connector to the
 * pointer. Without it the user clicks into the dark: nothing shows where the
 * line would land until the click that commits it.
 */
function ThreadLinkPreview({
  endpoint,
  cursor,
  scene,
  boardId,
}: {
  endpoint: { kind: string; id: string; connectorId: string };
  cursor: LinkAnchor;
  scene: LinkScene;
  boardId: string;
}) {
  const from = endpointAnchor(
    {
      kind: endpoint.kind === "section" ? "section" : "card",
      id: endpoint.id,
      connectorId: endpoint.connectorId,
    },
    boardId,
    scene,
    cursor,
  );
  if (!from) return null;

  return (
    <ViewportPortal>
      <svg
        className="section-link-preview-layer"
        data-testid="thread-link-preview"
        aria-hidden="true"
        focusable="false"
      >
        <line
          className="section-link-preview"
          x1={from.x}
          y1={from.y}
          x2={cursor.x}
          y2={cursor.y}
        />
        <circle className="section-link-preview__origin" cx={from.x} cy={from.y} r={4} />
      </svg>
    </ViewportPortal>
  );
}

/** A link React Flow draws between two of this board's nodes. */
interface FlowLink {
  edge: GraphEdge;
  source: string;
  target: string;
  offLens: boolean;
}

/** A gentle horizontal curve between two anchors, in flow coordinates. */
function sectionLinkPath(anchors: { source: LinkAnchor; target: LinkAnchor }): string {
  const { source, target } = anchors;
  const bend = Math.max(32, Math.min(160, Math.abs(target.x - source.x) / 2));
  const direction = target.x >= source.x ? 1 : -1;
  return `M ${source.x},${source.y} C ${source.x + bend * direction},${source.y} ${
    target.x - bend * direction
  },${target.y} ${target.x},${target.y}`;
}

/**
 * Links with a section end: a section is not a React Flow node, so its lines are
 * drawn here in flow space, anchored by the same geometry the cards use.
 */
function SectionLinkLayer({
  links,
  selectedEdgeIds,
  onSelectEdge,
  onEdgeContextMenu,
}: {
  links: SectionLink[];
  selectedEdgeIds: ReadonlySet<string>;
  onSelectEdge: (edgeId: string) => void;
  onEdgeContextMenu: (event: React.MouseEvent, edgeId: string) => void;
}) {
  if (links.length === 0) return null;

  return (
    <ViewportPortal>
      <svg
        className="section-link-layer"
        data-testid="section-link-layer"
        // Purely decorative: the links themselves are selectable through the hit
        // paths below, and the edge menu carries their accessible actions.
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <marker
            id="section-link-arrow"
            viewBox="0 0 18 18"
            markerWidth="12"
            markerHeight="12"
            refX="9"
            refY="9"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 18 9 L 0 18 z" className="section-link-arrow" />
          </marker>
        </defs>
        {links.map((link) => {
          const selected = selectedEdgeIds.has(link.edge.id);
          return (
            <g key={link.edge.id} data-edge-id={link.edge.id}>
              {/* A section is not a React Flow node, so this line needs its own
                  hit area and click handling to be selectable like any edge. */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: the hit path is the pointer affordance for an edge the edge menu already describes. */}
              <path
                className="section-link__hit"
                d={sectionLinkPath(link.anchors)}
                data-testid="section-link-hit"
                // React Flow's pane claims the press (it captures the pointer to
                // drag the camera), so a click that starts here never arrives as
                // a click on this path. Claiming the press first is what makes a
                // section link selectable at all.
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectEdge(link.edge.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectEdge(link.edge.id);
                  onEdgeContextMenu(event, link.edge.id);
                }}
              />
              <path
                data-testid="section-link"
                data-edge-id={link.edge.id}
                className={`section-link${link.offLens ? " is-off-lens" : ""}${
                  selected ? " is-selected" : ""
                }`}
                d={sectionLinkPath(link.anchors)}
                markerEnd="url(#section-link-arrow)"
              />
            </g>
          );
        })}
      </svg>
    </ViewportPortal>
  );
}

export function CanvasBoard() {
  countRender("canvas");

  useEffect(() => {
    markBoot("canvas:mounted");
    measureBoot("to-canvas", "store:created", "canvas:mounted");
  }, []);

  const snapshot = useWorkspaceSnapshot();
  const lens = useCanvasLens();
  useLensReferenceRepair(lens.view !== null);
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
  const linkMode = useUiStore((state) => state.linkMode);
  /**
   * When the last thread step happened. React Flow reports a connector release as
   * a *node click* too, and clearing the thread there would disarm it in the same
   * gesture that armed it.
   */
  const threadStepAt = useRef(0);
  const armedThread = useLinkThreadStore((state) => state.armed);
  const [threadCursor, setThreadCursor] = useState<LinkAnchor | null>(null);
  /**
   * The connector a gesture started on, readable synchronously. A click fires
   * connect-start and connect-end before React re-renders, so the state set by
   * the first is still null in the second.
   */
  const connectingDraft = useRef<{
    nodeId: string;
    connectorId: string;
    anchorEnd: "source" | "target";
  } | null>(null);
  const setLinkMode = useUiStore((state) => state.setLinkMode);

  // Releasing Shift ends a shift-armed thread: the modifier was the mode. A
  // thread started from the UI keeps going, because nothing is being held.
  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      const state = useLinkThreadStore.getState();
      if (state.armedBy === "shift") state.clear();
    };
    window.addEventListener("keyup", onKeyUp);
    return () => window.removeEventListener("keyup", onKeyUp);
  }, []);

  // A thread belongs to the mode it started in: leaving the mode must not leave
  // a connector armed in a mode that no longer chains on a plain click.
  // biome-ignore lint/correctness/useExhaustiveDependencies: linkMode is the trigger, not a value read in the effect.
  useEffect(() => {
    useLinkThreadStore.getState().clear();
  }, [linkMode]);
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

  // While a thread is armed the pointer is the other end of a line that is not
  // drawn yet, so follow it in flow coordinates.
  useEffect(() => {
    if (!armedThread) {
      setThreadCursor(null);
      return;
    }
    const follow = (event: PointerEvent) => {
      setThreadCursor(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    };
    window.addEventListener("pointermove", follow);
    return () => window.removeEventListener("pointermove", follow);
  }, [armedThread, screenToFlowPosition]);

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
    // Which links are drawable is decided when they are projected (an endpoint
    // may be a section or a board, not just a card); the document keeps links
    // whose ends are simply not on this board.
    return snapshot.edges.filter((edge) => edge.boardId === activeBoardId);
  }, [snapshot.edges, activeBoardId]);

  const boardPlacementList = useMemo(() => [...boardPlacements.values()], [boardPlacements]);

  /** Board cards in paint order (bottom to top), the order layer actions apply in. */
  const boardOrder = useMemo(() => boardCards.map((card) => card.id), [boardCards]);

  const boardSections = useMemo(() => {
    if (!activeBoardId) return [];
    return snapshot.sections.filter((section) => section.boardId === activeBoardId);
  }, [snapshot.sections, activeBoardId]);

  /** The first portal on this board per target board, in paint order. */
  const portalByTargetBoard = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of boardCards) {
      const target = portalTargetId(card);
      if (target && !map.has(target)) map.set(target, card.id);
    }
    return map;
  }, [boardCards]);

  /** Placements of live cards only, so a trashed card cannot anchor a line. */
  const linkPlacements = useMemo(
    () =>
      boardCards.flatMap((card) => {
        const placement = boardPlacements.get(card.id);
        return placement ? [placement] : [];
      }),
    [boardCards, boardPlacements],
  );

  /**
   * Everything a link endpoint resolves against, in flow coordinates. A board
   * endpoint has no position of its own: it is drawn through the portal that
   * opens it, which is why the portals travel with the scene.
   */
  const linkScene = useMemo<LinkScene>(
    () => ({
      placements: linkPlacements,
      sections: boardSections,
      cards: snapshot.cards,
      portals: activeBoardId
        ? [...portalByTargetBoard].map(([targetBoardId, cardId]) => ({
            boardId: activeBoardId,
            cardId,
            targetBoardId,
          }))
        : [],
    }),
    [linkPlacements, boardSections, snapshot.cards, portalByTargetBoard, activeBoardId],
  );

  /**
   * The React Flow node an endpoint is drawn through: a card is its own node, a
   * board is the portal standing in for it, and a section has no node at all.
   */
  const nodeIdForEndpoint = useCallback(
    (endpoint: { kind: EdgeEndpointKind; id: string }): string | null => {
      if (endpoint.kind === "card") return endpoint.id;
      if (endpoint.kind === "board") return portalByTargetBoard.get(endpoint.id) ?? null;
      return null;
    },
    [portalByTargetBoard],
  );

  /**
   * Every link on this board, resolved: cards and portals become React Flow
   * edges, anything touching a section becomes a flow-space line. A link whose
   * ends are not both here is simply not drawn — it stays in the document.
   */
  const projectedLinks = useMemo(() => {
    const flow: FlowLink[] = [];
    const sections: SectionLink[] = [];
    if (!activeBoardId) return { flow, sections };

    const onLens = (endpoint: { kind: EdgeEndpointKind; id: string }) =>
      endpoint.kind !== "card" || lens.cardIds.has(endpoint.id);

    for (const edge of boardEdges) {
      const ends = edgeEndpoints(edge);
      // The edge's own dots travel with the endpoints: without them a link that
      // touches a section (or any end without a React Flow handle) is drawn from
      // the facing side rather than from the connector it was attached to.
      const endpoints = {
        source: { ...ends.source, connectorId: edge.sourceConnector },
        target: { ...ends.target, connectorId: edge.targetConnector },
      };
      const anchors = linkAnchors(endpoints, activeBoardId, linkScene);
      if (!anchors) continue;
      const offLens = lens.view !== null && !(onLens(endpoints.source) && onLens(endpoints.target));
      const source = nodeIdForEndpoint(endpoints.source);
      const target = nodeIdForEndpoint(endpoints.target);
      if (source && target) flow.push({ edge, source, target, offLens });
      else sections.push({ edge, anchors, offLens });
    }
    return { flow, sections };
  }, [boardEdges, activeBoardId, linkScene, nodeIdForEndpoint, lens]);

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
  // A section is not a node, so its connector selection is board-local state
  // rather than the store's `selectedConnector` (which names a node id).
  const [selectedSectionConnector, setSelectedSectionConnector] = useState<{
    sectionId: string;
    connectorId: string;
  } | null>(null);

  // Connector dots appear while a link is being dragged: the drop targets have
  // to be visible mid-gesture. W2 will fold this into the link tool's state.
  const setLinkDraftActive = useLinkDraftStore((state) => state.setDraftActive);
  const revealState = useConnectorRevealState();
  useEffect(() => {
    setLinkDraftActive(Boolean(connecting) || Boolean(reconnecting));
    return () => setLinkDraftActive(false);
  }, [connecting, reconnecting, setLinkDraftActive]);

  // A press on a connector is a draft gesture even when the pointer never moves;
  // React Flow only reports an end for a real drag, so the release is observed
  // here. Otherwise a click would leave the draft — and every dot — showing.
  useEffect(() => {
    if (!connecting && !reconnecting) return;
    const clear = () => {
      reconnectGesture.current = false;
      setConnecting(null);
      setConnect(null);
      setReconnecting(null);
      setReconnect(null);
    };
    // `mouseup`, not `pointerup`: React Flow finishes the gesture on the mouse
    // event, so observing the pointer event first would clear the draft before
    // the drop could read it. Both listeners are bubble-phase on window, which
    // is after React Flow's document handlers.
    window.addEventListener("mouseup", clear);
    window.addEventListener("touchend", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("mouseup", clear);
      window.removeEventListener("touchend", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, [connecting, reconnecting, setConnect, setReconnect]);
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

  /**
   * A section is off the lens when none of its member cards is on it. Sections
   * stay visible: they are the spatial context a dimmed card sits in.
   */
  const dimmedSectionIds = useMemo(() => {
    if (lens.view === null) return undefined;
    const sectionsWithMatches = new Set<string>();
    for (const [cardId, sectionId] of sectionMembershipMap) {
      if (lens.cardIds.has(cardId)) sectionsWithMatches.add(sectionId);
    }
    const dimmed = new Set<string>();
    for (const sectionId of sectionMembershipMap.values()) {
      if (!sectionsWithMatches.has(sectionId)) dimmed.add(sectionId);
    }
    return dimmed;
  }, [lens, sectionMembershipMap]);

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
  /** True when `onConnect` already created this drag's link, so the drop is done. */
  const connectCommitted = useRef(false);
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
          // The lens is part of the card's visible state: a view applied or
          // cleared must repaint, and an unchanged card must keep its object.
          const dim = lens.view !== null && !lens.cardIds.has(card.id);
          const previousDim = previous?.dim === true;
          // Reuse the data object (and the node when nothing visible changed), so
          // a card that did not change does not re-render on a peer's edit.
          const data: CardNodeData =
            previous &&
            previous.card === card &&
            previous.placement === placement &&
            previous.type === type &&
            previous.meta === meta &&
            previousDim === dim
              ? previous
              : { card, placement, type, meta, ...(dim ? { dim: true } : {}) };
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
    [boardCards, boardPlacements, selectedKey, typeMap, metaByCard, cardOffsetsMap, setNodes, lens],
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

    const flowEdges: Edge[] = projectedLinks.flow.map((link) => {
      const flowEdge = toFlowEdge(
        link.edge,
        link,
        selectedEdges.has(link.edge.id),
        labelHandlers,
        peerByEdge.get(link.edge.id),
      );
      // An arrow leaves the lens when either endpoint does: a line to a card the
      // view excluded is context, not a result.
      const painted = link.offLens ? { ...flowEdge, className: "is-off-lens" } : flowEdge;
      return reconnecting.has(link.edge.id) ? { ...painted, hidden: true } : painted;
    });
    setEdges(flowEdges);
  }, [projectedLinks, peers, selectedEdgeIds, setEdges, labelHandlers]);

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
  // A dot is a screen-sized target, so its hit radius has to be divided by zoom
  // to stay the same size on a flow-space diagram.
  const zoom = useStore((state) => state.transform[2]);
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

  // A surface (the container panel) asked to step through a portal. The camera
  // owns the doorway — it needs the node's screen rect to fly from — so the
  // request is fulfilled here, where the node's geometry is known.
  const portalOpenRequest = useUiStore((state) => state.portalOpenRequest);
  const clearPortalOpenRequest = useUiStore((state) => state.clearPortalOpenRequest);
  useEffect(() => {
    if (!portalOpenRequest) return;
    enterPortal(portalOpenRequest.cardId, portalOpenRequest.boardId);
    clearPortalOpenRequest();
  }, [portalOpenRequest, enterPortal, clearPortalOpenRequest]);

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

      if (event.key === "Escape" && useLinkThreadStore.getState().armed) {
        useLinkThreadStore.getState().clear();
        state.setSelectedConnector(null);
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

  /**
   * What a drop on `hit` should link to. A portal card stands in for the board
   * it opens, so a link released on one points at the board, not at the card
   * that shows it; a section points at itself; a card stays a card.
   */
  const endpointForDrop = useCallback(
    (hit: { kind: EdgeEndpointKind; id: string }): { kind: EdgeEndpointKind; id: string } => {
      if (hit.kind !== "card") return hit;
      const targetBoard = portalTargetId(cardsById.get(hit.id));
      return targetBoard ? { kind: "board", id: targetBoard } : hit;
    },
    [cardsById],
  );

  /**
   * Resolves a flow point to what a link released there should point at. A
   * release on a dot resolves to that dot, whatever the entity's shape says:
   * otherwise a section-to-card link always leaves from the side facing the
   * section and ignores which port was aimed at.
   */
  const resolveLinkTarget = useCallback(
    (point: LinkAnchor): LinkEndpointRef | null => {
      if (!activeBoardId) return null;
      const hit =
        connectorAtPoint(point, activeBoardId, linkScene, CONNECTOR_DROP_RADIUS / zoom) ??
        endpointAtPoint(point, activeBoardId, linkScene);
      if (!hit) return null;
      const endpoint = endpointForDrop(hit);
      const connectorId = linkEndConnector(
        hit.kind === "card" ? hit.id : null,
        nodeIdForEndpoint(endpoint),
        hit.connectorId,
      );
      return connectorId ? { ...endpoint, connectorId } : endpoint;
    },
    [activeBoardId, linkScene, endpointForDrop, nodeIdForEndpoint, zoom],
  );

  const onSectionLinkCommit = useCallback(
    (from: LinkEndpointRef, to: LinkEndpointRef, origin: LinkAnchor) => {
      if (!canCreateContent || !activeBoardId) return;
      void origin;
      // Either end may be the section: a thread can start on a card's dot and
      // finish on a section's, so both kinds and both dots come from the caller.
      workspace.addEdge({
        boardId: activeBoardId,
        source: from.id,
        sourceKind: from.kind,
        target: to.id,
        targetKind: to.kind,
        ...(from.connectorId ? { sourceConnector: from.connectorId } : {}),
        // A board end keeps its dot too: the dot belongs to the portal the link
        // is drawn through, which is exactly what was released on.
        ...(to.connectorId ? { targetConnector: to.connectorId } : {}),
      });
    },
    [workspace, activeBoardId, canCreateContent],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!canCreateContent) return;
      if (!connection.source || !connection.target) return;
      if (!activeBoardId) return;
      // The release also reaches onConnectEnd; the link already exists.
      connectCommitted.current = true;
      const target = endpointForDrop({ kind: "card", id: connection.target });
      // A board target is drawn at the portal that opens it, so the portal's
      // connector is the anchor — unless the board has more than one portal here
      // and the line is painted on a different one, where that dot would be
      // unknown to React Flow and the link would vanish.
      const targetConnector = linkEndConnector(
        connection.target,
        nodeIdForEndpoint(target),
        connection.targetHandle,
      );
      const sourceConnector = linkEndConnector(
        connection.source,
        nodeIdForEndpoint({ kind: "card", id: connection.source }),
        connection.sourceHandle,
      );
      // A duplicate or a self-link comes back null; drawing one twice is a
      // quiet no-op, not an error.
      workspace.addEdge({
        boardId: activeBoardId,
        source: connection.source,
        target: target.id,
        targetKind: target.kind,
        ...(sourceConnector ? { sourceConnector } : {}),
        ...(targetConnector ? { targetConnector } : {}),
      });
    },
    [workspace, activeBoardId, canCreateContent, endpointForDrop, nodeIdForEndpoint],
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
      connectingDraft.current = { nodeId, connectorId: handleId, anchorEnd };

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

  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      const draft = connecting ?? connectingDraft.current;
      connectingDraft.current = null;
      const committed = connectCommitted.current;
      connectCommitted.current = false;
      setConnecting(null);
      setConnect(null);
      // Released on a connector dot: `onConnect` already wrote the link.
      if (committed) return;
      if (!draft) return;
      if (!canCreateContent || !activeBoardId) return;

      const client = clientPoint(event);
      // The event's own coordinates are the release point; `connectionState.pointer`
      // can lag a sample behind, which lands the drop on whatever was under the
      // pointer a frame earlier. A synthetic event carries 0,0, so fall back then.
      const usable = client && (client.x !== 0 || client.y !== 0) ? client : null;
      const point = usable ? screenToFlowPosition(usable) : (connectionState?.pointer ?? null);
      if (!point) return;
      // A section or a portal body has no handle to snap to, so the drop is
      // resolved geometrically. Releasing over a plain card keeps today's
      // behaviour: a card links from its dots, not its body.
      // React Flow knows which node the pointer was over; prefer it, because a
      // portal and the card beneath it overlap and geometry alone can disagree
      // with what the user aimed at.
      const overNodeId = connectionState?.toNode?.id;
      // A section has no React Flow node, so its dot is resolved geometrically —
      // with the dot, not just the shape, or the line lands on whichever side
      // faces the source instead of the connector it was dropped on.
      const hit: LinkEndpointRef | null = overNodeId
        ? { kind: "card", id: overNodeId }
        : resolveLinkTarget(point);
      if (!hit) return;
      const target = endpointForDrop(hit);
      if (target.kind === "card") return;

      const from = { kind: "card" as const, id: draft.nodeId };
      const source = draft.anchorEnd === "target" ? target : from;
      const other = draft.anchorEnd === "target" ? from : target;
      // The dot at the moving end is the one released on; the dot at the anchor
      // end is the one the gesture started from.
      const releasedConnector = hit.connectorId;
      workspace.addEdge({
        boardId: activeBoardId,
        source: source.id,
        sourceKind: source.kind,
        target: other.id,
        targetKind: other.kind,
        ...(draft.anchorEnd === "target"
          ? { targetConnector: draft.connectorId }
          : { sourceConnector: draft.connectorId }),
        ...(draft.anchorEnd === "target" && releasedConnector
          ? { sourceConnector: releasedConnector }
          : {}),
        ...(draft.anchorEnd === "source" && releasedConnector
          ? { targetConnector: releasedConnector }
          : {}),
      });
    },
    [
      connecting,
      canCreateContent,
      activeBoardId,
      screenToFlowPosition,
      resolveLinkTarget,
      endpointForDrop,
      workspace,
      setConnect,
    ],
  );

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
      // Reconnecting onto a portal retargets the board it opens, the same way a
      // fresh drop does; any other node stays a card endpoint.
      const target = endpointForDrop({ kind: "card", id: nodeId });
      workspace.reconnectEdge(
        oldEdge.id,
        end,
        target.id,
        target.kind === "card" ? (connectorId ?? undefined) : undefined,
        target.kind,
      );
    },
    [workspace, canEditLayout, endpointForDrop],
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

  const otherBoards = useCallback(
    (boardId: string | null) =>
      snapshot.boards
        .filter((board) => board.id !== boardId)
        .map((board) => ({ id: board.id, name: board.name })),
    [snapshot.boards],
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

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    // Menus are built from what this session may do, so a share never renders
    // an action its publish would reject. A viewer gets no menu at all.
    if (!contextMenu) return [];
    if (contextMenu.kind === "canvas") {
      if (!canCreateContent) return [];
      const flowPosition = contextMenu.flowPosition ?? { x: 0, y: 0 };
      // Every board is a possible target; creating one requires the board
      // capability, so a board share without it only sees existing boards.
      const portalItems: ContextMenuItem[] = [
        ...snapshot.boards
          .filter((board) => board.id !== activeBoardId)
          .map((board) => ({
            label: board.name,
            onSelect: () => createPortalAt(flowPosition, board.id),
          })),
        ...(canCreateBoards
          ? [
              {
                label: "New board and portal",
                onSelect: () => createPortalToNewBoard(flowPosition),
              },
            ]
          : []),
      ];
      return [
        {
          label: "New card",
          onSelect: () => {
            if (contextMenu.flowPosition) createNoteAt(contextMenu.flowPosition);
          },
        },
        {
          label: "New sketch",
          onSelect: () => createWhiteboardAt(flowPosition),
        },
        {
          label: "New section",
          onSelect: () => createSectionAt(flowPosition),
        },
        ...(portalItems.length > 0
          ? [
              {
                label: "New portal",
                items: portalItems,
              },
            ]
          : []),
        ...(selectedNodeIds.length > 0
          ? [
              {
                label: `New section from ${selectedNodeIds.length} card${
                  selectedNodeIds.length === 1 ? "" : "s"
                }`,
                onSelect: () => createSectionAt(flowPosition, true),
              },
            ]
          : []),
      ];
    }

    if (contextMenu.kind === "section" && contextMenu.sectionId) {
      if (!canEditLayout) return [];
      const sectionId = contextMenu.sectionId;
      const memberIds = [...sectionMembershipMap]
        .filter(([, id]) => id === sectionId)
        .map(([cardId]) => cardId);
      return [
        {
          label: "Rename section",
          onSelect: () => setEditingSection(sectionId),
        },
        {
          label: "Color",
          items: sectionColors.map((color) => ({
            label: color.charAt(0).toUpperCase() + color.slice(1),
            onSelect: () => workspace.setSectionColor(sectionId, color),
          })),
        },
        {
          label: `Select ${memberIds.length} card${memberIds.length === 1 ? "" : "s"}`,
          onSelect: () => {
            setSelectedNodeIds(memberIds);
            store.getState().addSelectedNodes(memberIds);
            selectSection(null);
          },
        },
        ...(canManageStructure
          ? [
              {
                label: "Add connector",
                onSelect: () => {
                  workspace.addSectionConnector(sectionId);
                },
              },
              {
                label: "Delete section",
                danger: true,
                onSelect: () => {
                  workspace.deleteSection(sectionId);
                  selectSection(null);
                  setSelectedSectionConnector(null);
                },
              },
            ]
          : []),
      ];
    }

    const nodeId = contextMenu.nodeId;
    const edgeId = contextMenu.edgeId;

    if (contextMenu.kind === "edge" && edgeId) {
      if (!canEditLayout) return [];
      const edge = workspace.getEdge(edgeId);
      return [
        {
          label: edge?.label ? "Edit description…" : "Add description…",
          onSelect: () => startEdgeDescription(edgeId, { x: contextMenu.x, y: contextMenu.y }),
        },
        ...(edge?.label
          ? [
              {
                label: "Remove description",
                danger: true,
                onSelect: () => workspace.setEdgeLabel(edgeId, null),
              },
            ]
          : []),
        {
          label: "Reverse direction",
          onSelect: () => workspace.reverseEdge(edgeId),
        },
        {
          label: edge?.bidirectional ? "Make one-way" : "Make bidirectional",
          onSelect: () => workspace.setEdgeBidirectional(edgeId, !edge?.bidirectional),
        },
        {
          label: "Path",
          items: [
            {
              label: edge?.path === "bezier" ? "Curved ✓" : "Curved",
              onSelect: () => workspace.setEdgePath(edgeId, "bezier"),
            },
            {
              label: edge?.path === "straight" ? "Straight ✓" : "Straight",
              onSelect: () => workspace.setEdgePath(edgeId, "straight"),
            },
            {
              label: edge?.path === "step" ? "Step ✓" : "Step",
              onSelect: () => workspace.setEdgePath(edgeId, "step"),
            },
            {
              label: edge?.path === "smoothstep" ? "Smooth step ✓" : "Smooth step",
              onSelect: () => workspace.setEdgePath(edgeId, "smoothstep"),
            },
          ],
        },
        {
          label: "Delete link",
          danger: true,
          onSelect: () => workspace.removeEdge(edgeId),
        },
      ];
    }

    if (contextMenu.kind === "connector") {
      if (!canManageStructure) return [];
      // The same toggle as the widget bar, where the user is already looking when
      // they right-click the dot they mean to start from.
      const linkModeItem = {
        label: linkMode === "thread" ? "Switch to connect mode" : "Switch to thread mode",
        onSelect: () => setLinkMode(linkMode === "thread" ? "connect" : "thread"),
      };
      // Section connectors address a section, card connectors address a node.
      if (contextMenu.sectionId && contextMenu.connectorId) {
        const { sectionId, connectorId } = contextMenu;
        return [
          linkModeItem,
          {
            label: "Reposition Connector",
            onSelect: () => setSelectedSectionConnector({ sectionId, connectorId }),
          },
          {
            label: "Delete connector",
            danger: true,
            onSelect: () => {
              workspace.removeSectionConnector(sectionId, connectorId);
              setSelectedSectionConnector(null);
            },
          },
        ];
      }
      return [
        linkModeItem,
        {
          label: "Reposition Connector",
          onSelect: () => {
            if (nodeId && contextMenu.connectorId) {
              setSelectedConnector({ nodeId, connectorId: contextMenu.connectorId });
            }
          },
        },
        {
          label: "Delete connector",
          danger: true,
          onSelect: () => {
            if (nodeId && contextMenu.connectorId) {
              workspace.removeConnector(nodeId, contextMenu.connectorId);
              setSelectedConnector(null);
            }
          },
        },
      ];
    }

    // Right-clicking a card that is part of a multi-selection acts on the whole
    // selection; a lone card keeps the single-card menu.
    const selection = selectionSummary(selectedNodeIds);
    if (nodeId && selection.multiple && selection.ids.includes(nodeId)) {
      const anchor = contextMenu.flowPosition ?? { x: 0, y: 0 };
      return [
        ...(canCreateContent
          ? [
              {
                label: `Duplicate ${selection.noun}`,
                onSelect: () => duplicateCards(selection.ids),
              },
            ]
          : []),
        ...(canCreateContent
          ? [
              {
                label: `New section from ${selection.noun}`,
                onSelect: () => createSectionAt(anchor, true),
              },
            ]
          : []),
        ...(canEditLayout
          ? [
              {
                label: "Position",
                items: [
                  {
                    label: "Bring Forward",
                    onSelect: () => changeLayerBulk(selection.ids, "forward"),
                  },
                  {
                    label: "Bring to Front",
                    onSelect: () => changeLayerBulk(selection.ids, "front"),
                  },
                  {
                    label: "Send Back",
                    onSelect: () => changeLayerBulk(selection.ids, "backward"),
                  },
                  {
                    label: "Send to Back",
                    onSelect: () => changeLayerBulk(selection.ids, "back"),
                  },
                ],
              },
              {
                label: "Remove from board",
                onSelect: () => unplaceSelected(),
              },
            ]
          : []),
        // Sharing is a link owner's right, and only a subset with two or more
        // cards is worth a link; the dialog opens on the selection scope.
        ...(canManageLinks
          ? [
              {
                label: `Share ${selection.noun}\u2026`,
                onSelect: () => requestShare("selection"),
              },
            ]
          : []),
        // Destructive entries stay last.
        ...(canManageTrash
          ? [
              {
                label: "Delete cards",
                danger: true,
                onSelect: () => trashSelected(),
              },
            ]
          : []),
      ];
    }

    const moveTargets = otherBoards(activeBoardId);
    const portalTarget = nodeId ? portalTargetId(cardsById.get(nodeId)) : null;
    return [
      ...(nodeId && portalTarget
        ? [
            {
              label: "Open portal",
              onSelect: () => enterPortal(nodeId, portalTarget),
            },
          ]
        : []),
      ...(canCreateContent
        ? [
            {
              label: "Duplicate",
              onSelect: () => {
                if (nodeId) duplicateCards([nodeId]);
              },
            },
          ]
        : []),
      ...(canEditLayout && moveTargets.length > 0
        ? [
            {
              label: "Move to board",
              items: moveTargets.map((board) => ({
                label: board.name,
                onSelect: () => {
                  if (nodeId) moveCardToBoard(nodeId, board.id);
                },
              })),
            },
          ]
        : []),
      ...(canManageStructure
        ? [
            {
              label: "Add connector",
              onSelect: () => {
                if (nodeId) workspace.addConnector(nodeId);
              },
            },
          ]
        : []),
      ...(canEditLayout
        ? [
            {
              label: "Position",
              items: [
                {
                  label: "Bring Forward",
                  onSelect: () => nodeId && changeLayer(nodeId, "forward"),
                },
                {
                  label: "Bring to Front",
                  onSelect: () => nodeId && changeLayer(nodeId, "front"),
                },
                {
                  label: "Send Back",
                  onSelect: () => nodeId && changeLayer(nodeId, "backward"),
                },
                {
                  label: "Send to Back",
                  onSelect: () => nodeId && changeLayer(nodeId, "back"),
                },
              ],
            },
            {
              label: "Remove from board",
              onSelect: () => {
                if (nodeId && activeBoardId) {
                  workspace.unplaceCard(activeBoardId, nodeId);
                  setSelectedNodeIds([]);
                  setSelectedConnector(null);
                }
              },
            },
          ]
        : []),
      ...(canManageTrash
        ? [
            {
              label: "Delete card",
              danger: true,
              onSelect: () => {
                if (nodeId) {
                  workspace.trashCard(nodeId);
                  setSelectedNodeIds([]);
                  setSelectedConnector(null);
                }
              },
            },
          ]
        : []),
    ];
  }, [
    contextMenu,
    workspace,
    activeBoardId,
    createNoteAt,
    createWhiteboardAt,
    createSectionAt,
    duplicateCards,
    moveCardToBoard,
    otherBoards,
    changeLayer,
    changeLayerBulk,
    unplaceSelected,
    trashSelected,
    selectedNodeIds,
    sectionMembershipMap,
    setEditingSection,
    selectSection,
    store,
    setSelectedNodeIds,
    setSelectedConnector,
    startEdgeDescription,
    canCreateContent,
    canEditLayout,
    canManageTrash,
    canManageStructure,
    canManageLinks,
    requestShare,
    snapshot.boards,
    createPortalAt,
    createPortalToNewBoard,
    canCreateBoards,
    cardsById,
    enterPortal,
    linkMode,
    setLinkMode,
  ]);

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
        // The layer itself rises while an edge is selected (see `.react-flow__edges`
        // in global.css); React Flow must not also raise the edge per element, or a
        // selected link keeps a 20px hit stroke over the cards once deselected.
        elevateEdgesOnSelect={false}
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
        onEdgeClick={() => {
          setSelectedConnector(null);
          setSelectedSectionConnector(null);
        }}
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
          const thread = useLinkThreadStore.getState();
          if (performance.now() - Math.max(threadStepAt.current, thread.armedAt) > 300) {
            thread.clear();
          }
          setSelectedConnector(null);
          setSelectedSectionConnector(null);
          handleSelectSection(null);
        }}
        onNodeClick={() => {
          // React Flow also reports a connector press as a node click, so this
          // must not undo the arm that press just made.
          const thread = useLinkThreadStore.getState();
          if (performance.now() - Math.max(threadStepAt.current, thread.armedAt) > 300) {
            thread.clear();
          }
          setSelectedConnector(null);
          setSelectedSectionConnector(null);
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
          dimmedSectionIds={dimmedSectionIds}
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
          threadMode={revealState.threadMode}
          draftActive={revealState.draftActive}
          armed={revealState.armed}
          selectedConnector={selectedSectionConnector}
          onConnectorSelect={(sectionId, connectorId) => {
            setSelectedSectionConnector({ sectionId, connectorId });
            setSelectedConnector(null);
          }}
          onConnectorMoveEnd={(sectionId, connectorId, position) => {
            if (!canManageStructure) return;
            workspace.moveSectionConnector(sectionId, connectorId, position);
          }}
          onConnectorContextMenu={(event, sectionId, connectorId) => {
            if (!canManageStructure) return;
            openContextMenu({
              x: event.clientX,
              y: event.clientY,
              kind: "connector",
              sectionId,
              connectorId,
            });
          }}
          resolveLinkTarget={resolveLinkTarget}
          onLinkCommit={onSectionLinkCommit}
        />
        <SectionLinkLayer
          links={projectedLinks.sections}
          selectedEdgeIds={new Set(selectedEdgeIds)}
          onSelectEdge={(edgeId) => {
            setSelectedConnector(null);
            setSelectedSectionConnector(null);
            setSelectedEdgeIds([edgeId]);
          }}
          onEdgeContextMenu={(event, edgeId) => {
            if (!canEditLayout) return;
            openContextMenu({ x: event.clientX, y: event.clientY, kind: "edge", edgeId });
          }}
        />
        <Background color="var(--rf-dot)" />
        <Controls showInteractive={false} />
        <PresenceLayer />
        <PeerReconnectLayer />
      </ReactFlow>
      {/* Outside React Flow: its pane preventDefaults pointerdown, which eats the
          click on any control nested inside it. */}
      {armedThread && threadCursor && activeBoardId ? (
        <ThreadLinkPreview
          endpoint={armedThread}
          cursor={threadCursor}
          scene={linkScene}
          boardId={activeBoardId}
        />
      ) : null}
      <LinkModeControl />
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
