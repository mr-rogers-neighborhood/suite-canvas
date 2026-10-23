import {
  type Card,
  type CardType,
  type Drawing,
  type LayerAction,
  sectionMembership,
  sectionMovePlan,
  type Tag,
  type WorkspaceDocument,
} from "@suite/graph";
import {
  buildScene,
  type Camera,
  DEFAULT_SCENE_CONFIG,
  hitTest,
  type LodKind,
  type LodState,
  type PortalGateState,
  type PortalInstance,
  type Rect,
  rectFromPoints,
  resolveLod,
  type Scene,
  type SceneBoardInput,
  type SceneCardInput,
  type SceneCounts,
  type SceneEdgeInput,
  type ScenePlacementInput,
  type SceneSectionInput,
  screenToPage,
} from "@suite/scene";
import {
  Background,
  Controls,
  ReactFlow,
  useReactFlow,
  useStore,
  useViewport,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EdgeDescriptionInput } from "../canvas/EdgeDescription";
import { prefersReducedMotion } from "../canvas/localEasing";
import { portalSizeForBounds } from "../canvas/PortalCard";
import { type BoardMiniatureModel, boardBounds, boardMiniature } from "../canvas/portalMiniature";
import { useCanvasMenuItems } from "../canvas/useCanvasMenuItems";
import { typesById } from "../cards/cardTypes";
import { ensureWhiteboardType, isWhiteboardCard } from "../cards/whiteboard";
import { ContextMenu } from "../components/ContextMenu";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { sceneOutlineItems } from "./outlineAdapter";
import { SceneLayer } from "./SceneLayer";
import { SceneOutline, type SceneOutlineItem } from "./SceneOutline";
import { type SceneConnectorCreate, useSceneInteraction } from "./useSceneInteraction";

const EMPTY_NODES = [] as never[];
const EMPTY_EDGES = [] as never[];
const FIT_PADDING = 0.12;
const FOCUS_DURATION_MS = 220;

interface FocusEntry {
  readonly boardKey: string;
  readonly label: string;
  readonly parentKey: string;
  readonly checkpoint: Camera;
}

interface PreparedScene {
  readonly boards: readonly SceneBoardInput[];
  readonly cards: readonly SceneCardInput[];
  readonly placements: readonly ScenePlacementInput[];
  readonly sections: readonly SceneSectionInput[];
  readonly edges: readonly SceneEdgeInput[];
  readonly titles: Readonly<Record<string, string>>;
  readonly cardsById: ReadonlyMap<string, Card>;
  readonly typesById: Map<string, CardType>;
  readonly tagsById: Map<string, Tag>;
  readonly miniatures: ReadonlyMap<string, BoardMiniatureModel>;
  readonly drawings: ReadonlyMap<string, Drawing>;
}

function groupByBoard<T extends { boardId: string }>(items: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const bucket = grouped.get(item.boardId);
    if (bucket) bucket.push(item);
    else grouped.set(item.boardId, [item]);
  }
  return grouped;
}

function prepareScene(snapshot: WorkspaceSnapshot, workspace: WorkspaceDocument): PreparedScene {
  const sectionsByBoard = groupByBoard(snapshot.sections);
  const placementsByBoard = groupByBoard(snapshot.placements);

  const miniatures = new Map<string, BoardMiniatureModel>();
  const drawings = new Map<string, Drawing>();
  for (const board of snapshot.boards) {
    miniatures.set(
      board.id,
      boardMiniature(sectionsByBoard.get(board.id) ?? [], placementsByBoard.get(board.id) ?? []),
    );
  }
  for (const card of snapshot.cards) {
    if (!isWhiteboardCard(card)) continue;
    const drawing = workspace.drawing(card.id);
    if (drawing) drawings.set(card.id, drawing);
  }

  return {
    boards: snapshot.boards.map((board) => ({ id: board.id, name: board.name })),
    cards: snapshot.cards.map((card) => ({
      id: card.id,
      primaryTypeId: card.primaryTypeId,
      properties: card.properties,
      connectors: card.connectors,
    })),
    placements: snapshot.placements.map((placement) => ({
      boardId: placement.boardId,
      cardId: placement.cardId,
      x: placement.x,
      y: placement.y,
      z: placement.z,
      ...(placement.width === undefined ? {} : { width: placement.width }),
      ...(placement.height === undefined ? {} : { height: placement.height }),
    })),
    sections: snapshot.sections.map((section) => ({
      id: section.id,
      boardId: section.boardId,
      title: section.title,
      x: section.x,
      y: section.y,
      width: section.width,
      height: section.height,
      z: section.z,
      ...(section.color === undefined ? {} : { color: section.color }),
    })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      boardId: edge.boardId,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      path: edge.path,
      ...(edge.sourceConnector === undefined ? {} : { sourceConnector: edge.sourceConnector }),
      ...(edge.targetConnector === undefined ? {} : { targetConnector: edge.targetConnector }),
      ...(edge.label === undefined ? {} : { label: edge.label }),
    })),
    titles: Object.fromEntries(
      snapshot.cards.map((card) => [card.id, workspace.displayTitle(card.id)]),
    ),
    cardsById: new Map(snapshot.cards.map((card) => [card.id, card] as const)),
    typesById: typesById(snapshot.types),
    tagsById: new Map(snapshot.tags.map((tag) => [tag.id, tag] as const)),
    miniatures,
    drawings,
  };
}

function flowSurfaceHref(): string {
  if (typeof window === "undefined") return "?canvas=flow";
  const url = new URL(window.location.href);
  url.searchParams.set("canvas", "flow");
  return `${url.pathname}${url.search}${url.hash}`;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function SceneBadge({
  counts,
  boardName,
  path,
}: {
  counts?: SceneCounts;
  boardName?: string;
  path?: readonly string[];
}) {
  const href = useMemo(flowSurfaceHref, []);
  const summary = counts
    ? [
        countLabel(counts.boards, "board"),
        countLabel(counts.cards, "card"),
        countLabel(counts.portals, "portal"),
      ].join(" \u00b7 ")
    : "Infinite, fractal scene";

  return (
    <div className="scene-board__badge" data-testid="scene-preview-badge">
      <span className="scene-board__badge-title">Infinite canvas</span>
      <span className="scene-board__counts" data-testid="scene-preview-counts">
        {summary}
      </span>
      {boardName ? (
        <span className="scene-board__root" data-testid="scene-preview-root">
          {boardName}
          {path && path.length > 0 ? ` / ${path.join(" / ")}` : ""}
          {counts && counts.expandedPortals > 0
            ? ` \u00b7 ${countLabel(counts.expandedPortals, "live portal")}`
            : ""}
        </span>
      ) : null}
      <a className="scene-board__link" data-testid="scene-preview-flow-link" href={href}>
        Back to board
      </a>
    </div>
  );
}

function SceneEmptySurface({ hasBoardId }: { hasBoardId: boolean }) {
  return (
    <div className="scene-board" data-testid="scene-board">
      <SceneBadge />
      <div className="scene-board__empty" data-testid="scene-board-empty">
        <div className="scene-board__empty-card">
          <p className="scene-board__empty-title">
            {hasBoardId ? "This board is unavailable" : "No board selected"}
          </p>
          <p className="scene-board__empty-copy">
            {hasBoardId
              ? "The active board no longer exists in this workspace. Pick another tab to preview its scene."
              : "Pick a board tab to preview its scene."}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The read-only scene surface. React Flow is only the camera: the projection,
 * LOD and portal recursion are rendered by `SceneLayer` inside the viewport.
 */
export function SceneBoard() {
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const rootBoard = activeBoardId
    ? snapshot.boards.find((board) => board.id === activeBoardId)
    : undefined;

  if (!activeBoardId || !rootBoard) {
    return <SceneEmptySurface hasBoardId={Boolean(activeBoardId)} />;
  }

  return <SceneCanvas snapshot={snapshot} rootBoardId={activeBoardId} boardName={rootBoard.name} />;
}

function SceneCanvas({
  snapshot,
  rootBoardId,
  boardName,
}: {
  snapshot: WorkspaceSnapshot;
  rootBoardId: string;
  boardName: string;
}) {
  const workspace = useCanvasStore((state) => state.workspace);
  const prepared = useMemo(() => prepareScene(snapshot, workspace), [snapshot, workspace]);

  return (
    <div className="scene-board" data-testid="scene-board">
      <ReactFlow
        nodes={EMPTY_NODES}
        edges={EMPTY_EDGES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        selectionOnDrag={false}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        // Left drag is the scene marquee; middle/right keep React Flow's pan.
        panOnDrag={[1, 2]}
      >
        <Background color="var(--rf-dot)" />
        <Controls showInteractive={false} />
        <SceneViewport prepared={prepared} rootBoardId={rootBoardId} boardName={boardName} />
      </ReactFlow>
    </div>
  );
}

function SceneViewport({
  prepared,
  rootBoardId,
  boardName,
}: {
  prepared: PreparedScene;
  rootBoardId: string;
  boardName: string;
}) {
  const viewport = useViewport();
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  const { fitBounds, setViewport } = useReactFlow();
  const [tick, setTick] = useState(() => Date.now());
  const [focusPath, setFocusPath] = useState<FocusEntry[]>([]);
  const lodStates = useRef<Record<string, LodState>>({});
  const gateStates = useRef<Record<string, PortalGateState>>({});
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [collapsedOutline, setCollapsedOutline] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const canEditLayout = useUiStore((state) => state.canEditLayout && !state.readOnly);
  const canCreateContent = useUiStore((state) => state.canCreateContent && !state.readOnly);
  const canCreateBoards = useUiStore((state) => state.canCreateBoards && !state.readOnly);
  const canManageStructure = useUiStore((state) => state.canManageTrash && !state.readOnly);
  const canManageTrash = useUiStore((state) => state.canManageTrash && !state.readOnly);
  const canManageLinks = useUiStore((state) => state.canManageLinks && !state.readOnly);
  // Peers on this board; presence is workspace-wide, so it has to be filtered.
  const peers = useBoardPeers(rootBoardId);
  const contextMenu = useUiStore((state) => state.contextMenu);
  const openContextMenu = useUiStore((state) => state.openContextMenu);
  const closeContextMenu = useUiStore((state) => state.closeContextMenu);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);
  const setSelectedConnector = useUiStore((state) => state.setSelectedConnector);
  const setSelectedEdgeIds = useUiStore((state) => state.setSelectedEdgeIds);
  const selectSection = useUiStore((state) => state.selectSection);
  const setEditingSection = useUiStore((state) => state.setEditingSection);
  const [edgeDescription, setEdgeDescription] = useState<{
    edgeId: string;
    x: number;
    y: number;
    value: string;
  } | null>(null);

  const camera = useMemo<Camera>(
    () => ({
      x: viewport.x,
      y: viewport.y,
      zoom: viewport.zoom > 0 && Number.isFinite(viewport.zoom) ? viewport.zoom : 1,
    }),
    [viewport.x, viewport.y, viewport.zoom],
  );

  const pageViewport = useMemo<Rect>(
    () =>
      rectFromPoints(
        screenToPage(camera, { x: 0, y: 0 }),
        screenToPage(camera, { x: paneWidth, y: paneHeight }),
      ),
    [camera, paneWidth, paneHeight],
  );

  const scene = useMemo<Scene>(
    () =>
      buildScene({
        boards: prepared.boards,
        cards: prepared.cards,
        placements: prepared.placements,
        sections: prepared.sections,
        edges: prepared.edges,
        rootBoardId,
        camera,
        titles: prepared.titles,
        lodStates: lodStates.current,
        gateStates: gateStates.current,
        nowMs: Math.max(tick, Date.now()),
      }),
    [prepared, rootBoardId, camera, tick],
  );

  // Keep the resolved bands and portal gates for the next frame. Pending
  // upgrades (dwell) wake the scene once instead of recomputing per render.
  useEffect(() => {
    const now = Date.now();
    const config = DEFAULT_SCENE_CONFIG;
    const boardScale = new Map(
      scene.boards.map((board) => [board.key, board.transform.scale * scene.camera.zoom]),
    );
    const nextLod: Record<string, LodState> = {};
    const pending = { lod: false, portal: false };

    const remember = (key: string, scale: number | undefined, kind: LodKind) => {
      const state = resolveLod(lodStates.current[key], scale ?? 0, now, config.lod, kind);
      nextLod[key] = state;
      if (state.pendingBand !== null) pending.lod = true;
    };

    for (const board of scene.boards) remember(board.key, boardScale.get(board.key), "card");
    for (const card of scene.cards) {
      remember(card.key, boardScale.get(card.boardKey), card.portalKey ? "portal" : "card");
    }
    for (const section of scene.sections) {
      remember(section.key, boardScale.get(section.boardKey), "section");
    }
    for (const edge of scene.edges) remember(edge.key, boardScale.get(edge.boardKey), "edge");
    lodStates.current = nextLod;

    const nextGates: Record<string, PortalGateState> = {};
    for (const portal of scene.portals) {
      nextGates[portal.key] = portal.gate;
      if (portal.gate.pendingSinceMs !== null) pending.portal = true;
    }
    gateStates.current = nextGates;

    if (!pending.lod && !pending.portal) return undefined;
    const wait = Math.max(
      pending.lod ? config.lod.dwellMs : 0,
      pending.portal ? config.portal.dwellMs : 0,
    );
    const timer = window.setTimeout(() => {
      setTick((previous) => Math.max(Date.now(), previous + 1));
    }, wait + 8);
    return () => window.clearTimeout(timer);
  }, [scene]);

  const fittedRoot = useRef<string | null>(null);
  useEffect(() => {
    if (paneWidth <= 0 || paneHeight <= 0) return;
    if (fittedRoot.current === rootBoardId) return;
    fittedRoot.current = rootBoardId;
    void fitBounds(scene.root.frame, {
      padding: FIT_PADDING,
      duration: prefersReducedMotion() ? 0 : FOCUS_DURATION_MS,
    });
  }, [fitBounds, paneWidth, paneHeight, rootBoardId, scene.root.frame]);

  const boardsByKey = useMemo(
    () => new Map(scene.boards.map((board) => [board.key, board] as const)),
    [scene.boards],
  );
  const portalsByKey = useMemo(
    () => new Map(scene.portals.map((portal) => [portal.key, portal] as const)),
    [scene.portals],
  );
  const outlineItems = useMemo(
    () => sceneOutlineItems(scene, collapsedOutline),
    [scene, collapsedOutline],
  );

  const toggleOutlineItem = useCallback((item: SceneOutlineItem) => {
    setCollapsedOutline((previous) => {
      const next = new Set(previous);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  const enterPortal = useCallback(
    (portal: PortalInstance) => {
      const board = portal.childKey ? boardsByKey.get(portal.childKey) : undefined;
      const target = board?.frame ?? portal.frame;
      const parentKey = activeOutlineId ?? scene.root.key;
      setFocusPath((previous) => [
        ...previous,
        {
          boardKey: board?.key ?? portal.childKey ?? portal.targetBoardId,
          label: board?.name ?? portal.targetBoardName ?? "Portal",
          parentKey,
          checkpoint: camera,
        },
      ]);
      setActiveOutlineId(portal.key);
      void fitBounds(target, {
        padding: 0.18,
        duration: prefersReducedMotion() ? 0 : FOCUS_DURATION_MS,
      });
    },
    [activeOutlineId, boardsByKey, camera, fitBounds, scene.root.key],
  );

  const goBack = useCallback(() => {
    const entry = focusPath[focusPath.length - 1];
    if (!entry) return;
    setFocusPath(focusPath.slice(0, -1));
    setActiveOutlineId(entry.parentKey);
    void setViewport(entry.checkpoint, {
      duration: prefersReducedMotion() ? 0 : FOCUS_DURATION_MS,
    });
  }, [focusPath, setViewport]);

  // Selection, marquee, card/section gestures and connector drags live in one
  // hook so every gesture shares the same hit testing and commit point.
  const planSectionMove = useCallback(
    (sectionId: string) => {
      const section = snapshot.sections.find((entry) => entry.id === sectionId);
      if (!section) return null;
      const plan = sectionMovePlan(
        sectionId,
        snapshot.sections.filter((entry) => entry.boardId === section.boardId),
        snapshot.placements.filter((entry) => entry.boardId === section.boardId),
      );
      if (plan.sections.length === 0) return null;
      return {
        sections: plan.sections.map((entry) => ({ id: entry.id, x: entry.x, y: entry.y })),
        placements: plan.placements.map((entry) => ({
          boardId: entry.boardId,
          cardId: entry.cardId,
          x: entry.x,
          y: entry.y,
        })),
      };
    },
    [snapshot.placements, snapshot.sections],
  );

  const connectorsFor = useCallback(
    (cardId: string) => prepared.cardsById.get(cardId)?.connectors ?? [],
    [prepared.cardsById],
  );

  const createConnector = useCallback(
    (input: SceneConnectorCreate) => {
      if (!canCreateContent) return;
      workspace.addEdge({
        boardId: input.boardId,
        source: input.sourceCardId,
        target: input.targetCardId,
        ...(input.sourceConnectorId === null ? {} : { sourceConnector: input.sourceConnectorId }),
        ...(input.targetConnectorId === null ? {} : { targetConnector: input.targetConnectorId }),
      });
    },
    [canCreateContent, workspace],
  );

  const interaction = useSceneInteraction({
    scene,
    canEditLayout,
    workspace,
    onFocusPortal: enterPortal,
    planSectionMove,
    connectorsFor,
    ...(canCreateContent ? { createConnector } : {}),
  });

  const placements = snapshot.placements;
  const sections = snapshot.sections;
  const sectionMembershipMap = useMemo(
    () =>
      sectionMembership(
        placements.filter((placement) => placement.boardId === rootBoardId),
        sections.filter((section) => section.boardId === rootBoardId),
      ),
    [placements, rootBoardId, sections],
  );

  const createNoteAt = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent) return;
      const card = workspace.createCard({ boardId: rootBoardId, position });
      setSelectedNodeIds([card.id]);
      useUiStore.getState().startEditing(card.id, "title");
    },
    [canCreateContent, rootBoardId, setSelectedNodeIds, workspace],
  );

  const createWhiteboardAt = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent) return;
      const type = ensureWhiteboardType(workspace);
      const card = workspace.createCard({ typeId: type.id, boardId: rootBoardId, position });
      setSelectedNodeIds([card.id]);
      useUiStore.getState().openCardFocus(card.id);
    },
    [canCreateContent, rootBoardId, setSelectedNodeIds, workspace],
  );

  const createSectionAt = useCallback(
    (position: { x: number; y: number }, wrapSelection = false) => {
      if (!canCreateContent) return;
      const ids = useUiStore.getState().selectedNodeIds;
      let rect = { x: position.x, y: position.y, width: 360, height: 260 };
      if (wrapSelection && ids.length > 0) {
        const cards = scene.cards.filter(
          (card) => ids.includes(card.cardId) && card.boardId === rootBoardId,
        );
        if (cards.length > 0) {
          const minX = Math.min(...cards.map((card) => card.local.x));
          const minY = Math.min(...cards.map((card) => card.local.y));
          const maxX = Math.max(...cards.map((card) => card.local.x + card.local.width));
          const maxY = Math.max(...cards.map((card) => card.local.y + card.local.height));
          rect = {
            x: minX,
            y: minY - 16,
            width: Math.max(360, maxX - minX),
            height: Math.max(260, maxY - minY + 16),
          };
        }
      }
      const section = workspace.createSection({ boardId: rootBoardId, ...rect });
      setSelectedNodeIds([]);
      selectSection(section.id);
      setEditingSection(section.id);
    },
    [
      canCreateContent,
      rootBoardId,
      scene.cards,
      selectSection,
      setEditingSection,
      setSelectedNodeIds,
      workspace,
    ],
  );

  const createPortalAt = useCallback(
    (position: { x: number; y: number }, targetBoardId: string) => {
      if (!canCreateContent) return;
      const card = workspace.createPortalCard({
        boardId: rootBoardId,
        targetBoardId,
        position,
        size: portalSizeForBounds(
          boardBounds(
            sections.filter((section) => section.boardId === targetBoardId),
            placements.filter((placement) => placement.boardId === targetBoardId),
          ),
        ),
      });
      setSelectedNodeIds([card.id]);
    },
    [canCreateContent, placements, rootBoardId, sections, setSelectedNodeIds, workspace],
  );

  const createPortalToNewBoard = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent || !canCreateBoards) return;
      const board = workspace.createBoard();
      createPortalAt(position, board.id);
    },
    [canCreateBoards, canCreateContent, createPortalAt, workspace],
  );

  const duplicateCards = useCallback(
    (ids: string[]) => {
      if (!canCreateContent) return;
      for (const id of ids) {
        workspace.duplicateCard(id, {
          boardId: rootBoardId,
          offset: { x: 24, y: 24 },
        });
      }
    },
    [canCreateContent, rootBoardId, workspace],
  );

  const startEdgeDescription = useCallback(
    (edgeId: string, point: { x: number; y: number }) => {
      const edge = workspace.getEdge(edgeId);
      if (!edge) return;
      setEdgeDescription({ edgeId, x: point.x, y: point.y, value: edge.label ?? "" });
    },
    [workspace],
  );

  const enterScenePortal = useCallback(
    (nodeId: string, _targetBoardId: string) => {
      const portal = scene.portals.find((candidate) => candidate.cardId === nodeId);
      if (portal) enterPortal(portal);
    },
    [enterPortal, scene.portals],
  );

  const moveCardToBoard = useCallback(
    (cardId: string, boardId: string) => {
      if (!canEditLayout) return;
      workspace.moveCardToBoard(cardId, boardId);
      setSelectedNodeIds([]);
    },
    [canEditLayout, setSelectedNodeIds, workspace],
  );

  const unplaceSelected = useCallback(() => {
    if (!canEditLayout) return;
    for (const id of useUiStore.getState().selectedNodeIds) {
      workspace.unplaceCard(rootBoardId, id);
    }
    setSelectedNodeIds([]);
  }, [canEditLayout, rootBoardId, setSelectedNodeIds, workspace]);

  const trashSelected = useCallback(() => {
    if (!canManageTrash) return;
    for (const id of useUiStore.getState().selectedNodeIds) {
      workspace.trashCard(id);
    }
    setSelectedNodeIds([]);
  }, [canManageTrash, setSelectedNodeIds, workspace]);

  const changeLayer = useCallback(
    (nodeId: string, action: LayerAction) => {
      if (!canEditLayout) return;
      workspace.moveLayer(rootBoardId, nodeId, action);
      setSelectedNodeIds([]);
    },
    [canEditLayout, rootBoardId, setSelectedNodeIds, workspace],
  );

  const changeLayerBulk = useCallback(
    (ids: string[], action: LayerAction) => {
      if (!canEditLayout) return;
      for (const id of ids) workspace.moveLayer(rootBoardId, id, action);
      setSelectedNodeIds([]);
    },
    [canEditLayout, rootBoardId, setSelectedNodeIds, workspace],
  );

  const requestShare = useUiStore((state) => state.requestShare);

  const menuItems = useCanvasMenuItems({
    contextMenu,
    workspace,
    snapshot,
    activeBoardId: rootBoardId,
    selectedNodeIds,
    sectionMembershipMap,
    setSelectedNodeIds,
    setSelectedConnector,
    selectSection,
    setEditingSection,
    canCreateContent,
    canCreateBoards,
    canEditContent: canCreateContent,
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
    enterPortal: enterScenePortal,
    moveCardToBoard,
    unplaceSelected,
    trashSelected,
    changeLayer,
    changeLayerBulk,
    requestShare,
  });

  const commitEdgeDescription = useCallback(
    (value: string) => {
      if (!edgeDescription) return;
      workspace.setEdgeLabel(edgeDescription.edgeId, value.trim() ? value : null);
      setEdgeDescription(null);
    },
    [edgeDescription, workspace],
  );

  const focusOutlineItem = useCallback(
    (item: SceneOutlineItem) => {
      if (item.id === scene.root.key) {
        setFocusPath([]);
        setActiveOutlineId(scene.root.key);
        void fitBounds(scene.root.frame, {
          padding: FIT_PADDING,
          duration: prefersReducedMotion() ? 0 : FOCUS_DURATION_MS,
        });
        return;
      }
      const portal = portalsByKey.get(item.id);
      if (portal) {
        enterPortal(portal);
        return;
      }
      setActiveOutlineId(item.id);
      const boardKey = item.kind === "board" ? item.id : null;
      const board = boardKey ? boardsByKey.get(boardKey) : undefined;
      if (!board) return;
      void fitBounds(board.frame, {
        padding: 0.18,
        duration: prefersReducedMotion() ? 0 : FOCUS_DURATION_MS,
      });
    },
    [boardsByKey, enterPortal, fitBounds, portalsByKey, scene.root.frame, scene.root.key],
  );

  useEffect(() => {
    setFocusPath([]);
    setActiveOutlineId(rootBoardId);
  }, [rootBoardId]);

  useEffect(() => {
    if (focusPath.length === 0) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      goBack();
    };
    // Capture so back-navigation claims Escape before the surface clears the
    // selection; `useSceneInteraction` skips events already handled.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [focusPath.length, goBack]);

  return (
    <>
      <ViewportPortal>
        <div
          className="scene-surface"
          data-testid="scene-surface"
          role="application"
          aria-label="Infinite canvas"
          style={{
            left: pageViewport.x,
            top: pageViewport.y,
            width: pageViewport.width,
            height: pageViewport.height,
          }}
          {...interaction.handlers}
          onContextMenu={(event) => {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            const page = screenToPage(camera, screen);
            const hit = hitTest(scene, camera, screen);
            const point = hit.kind === "pane" ? page : hit.board;
            if (hit.kind === "card" || hit.kind === "portal") {
              if (!useUiStore.getState().selectedNodeIds.includes(hit.cardId)) {
                selectSection(null);
                setSelectedNodeIds([hit.cardId]);
              }
              openContextMenu({
                x: event.clientX,
                y: event.clientY,
                kind: "node",
                nodeId: hit.cardId,
                flowPosition: point,
              });
            } else if (hit.kind === "section") {
              selectSection(hit.sectionId);
              openContextMenu({
                x: event.clientX,
                y: event.clientY,
                kind: "section",
                sectionId: hit.sectionId,
                flowPosition: point,
              });
            } else if (hit.kind === "edge") {
              // The edge never owns a card selection, so the highlight is the
              // same one a left click would leave behind.
              selectSection(null);
              setSelectedNodeIds([]);
              setSelectedEdgeIds([hit.edgeId]);
              openContextMenu({
                x: event.clientX,
                y: event.clientY,
                kind: "edge",
                edgeId: hit.edgeId,
                flowPosition: point,
              });
            } else {
              openContextMenu({
                x: event.clientX,
                y: event.clientY,
                kind: "canvas",
                flowPosition: point,
              });
            }
          }}
        />
        <SceneLayer
          scene={scene}
          onFocusPortal={enterPortal}
          viewport={pageViewport}
          cards={prepared.cardsById}
          types={prepared.typesById}
          tags={prepared.tagsById}
          miniatures={prepared.miniatures}
          drawings={prepared.drawings}
          selectedIds={interaction.selectedIds}
          selectedSectionId={interaction.selectedSectionId}
          selectedEdgeIds={interaction.selectedEdgeIds}
          overrides={interaction.overrides}
          marquee={interaction.marquee}
          connectorHandles={interaction.connectorHandles}
          connectorDrag={interaction.connectorDrag}
          canEditLayout={canEditLayout}
          peers={peers}
          liveCards
        />
      </ViewportPortal>
      <SceneBadge
        counts={scene.counts}
        boardName={boardName}
        path={focusPath.map((entry) => entry.label)}
      />
      {scene.counts.cards === 0 ? (
        <div className="scene-board__empty" data-testid="scene-board-empty">
          <div className="scene-board__empty-card">
            <p className="scene-board__empty-title">Nothing on this board yet</p>
            <p className="scene-board__empty-copy">
              Cards, sections and portals appear here as you build the scene.
            </p>
          </div>
        </div>
      ) : null}
      {edgeDescription ? (
        <EdgeDescriptionInput
          key={edgeDescription.edgeId}
          x={edgeDescription.x}
          y={edgeDescription.y}
          value={edgeDescription.value}
          onCommit={commitEdgeDescription}
          onCancel={() => setEdgeDescription(null)}
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
      <div className="scene-board__outline">
        <SceneOutline
          items={outlineItems}
          activeId={activeOutlineId ?? scene.root.key}
          open={outlineOpen}
          onToggleOpen={() => setOutlineOpen((open) => !open)}
          onSelect={focusOutlineItem}
          onToggleExpand={toggleOutlineItem}
          {...(focusPath.length > 0 ? { onBack: goBack } : {})}
        />
      </div>
    </>
  );
}
