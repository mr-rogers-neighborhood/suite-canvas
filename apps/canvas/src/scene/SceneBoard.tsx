import type { Card, CardType, Tag, WorkspaceDocument } from "@suite/graph";
import {
  buildScene,
  type Camera,
  DEFAULT_SCENE_CONFIG,
  type LodKind,
  type LodState,
  type PortalGateState,
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
import { prefersReducedMotion } from "../canvas/localEasing";
import { type BoardMiniatureModel, boardMiniature } from "../canvas/portalMiniature";
import { typesById } from "../cards/cardTypes";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { sceneOutlineItems } from "./outlineAdapter";
import { SceneLayer } from "./SceneLayer";
import { SceneOutline, type SceneOutlineItem } from "./SceneOutline";

const EMPTY_NODES = [] as never[];
const EMPTY_EDGES = [] as never[];
const FIT_PADDING = 0.12;
const FOCUS_DURATION_MS = 220;

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
  for (const board of snapshot.boards) {
    miniatures.set(
      board.id,
      boardMiniature(sectionsByBoard.get(board.id) ?? [], placementsByBoard.get(board.id) ?? []),
    );
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

function SceneBadge({ counts, boardName }: { counts?: SceneCounts; boardName?: string }) {
  const href = useMemo(flowSurfaceHref, []);
  const summary = counts
    ? [
        countLabel(counts.boards, "board"),
        countLabel(counts.cards, "card"),
        countLabel(counts.portals, "portal"),
      ].join(" \u00b7 ")
    : "Read-only projection of the workspace graph";

  return (
    <div className="scene-board__badge" data-testid="scene-preview-badge">
      <span className="scene-board__badge-title">Scene preview</span>
      <span className="scene-board__counts" data-testid="scene-preview-counts">
        {summary}
      </span>
      {boardName ? (
        <span className="scene-board__root" data-testid="scene-preview-root">
          {boardName}
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
  const { fitBounds } = useReactFlow();
  const [tick, setTick] = useState(() => Date.now());
  const lodStates = useRef<Record<string, LodState>>({});
  const gateStates = useRef<Record<string, PortalGateState>>({});
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [collapsedOutline, setCollapsedOutline] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);

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

  const focusOutlineItem = useCallback(
    (item: SceneOutlineItem) => {
      setActiveOutlineId(item.id);
      const portal = portalsByKey.get(item.id);
      const boardKey = portal?.childKey ?? (item.kind === "board" ? item.id : null);
      const board = boardKey ? boardsByKey.get(boardKey) : undefined;
      const target = board?.frame ?? portal?.frame;
      if (!target) return;
      void fitBounds(target, {
        padding: 0.18,
        duration: prefersReducedMotion() ? 0 : FOCUS_DURATION_MS,
      });
    },
    [boardsByKey, portalsByKey, fitBounds],
  );

  return (
    <>
      <ViewportPortal>
        <SceneLayer
          scene={scene}
          viewport={pageViewport}
          cards={prepared.cardsById}
          types={prepared.typesById}
          tags={prepared.tagsById}
          miniatures={prepared.miniatures}
        />
      </ViewportPortal>
      <SceneBadge counts={scene.counts} boardName={boardName} />
      {scene.counts.cards === 0 ? (
        <div className="scene-board__empty" data-testid="scene-board-empty">
          <div className="scene-board__empty-card">
            <p className="scene-board__empty-title">Nothing on this board yet</p>
            <p className="scene-board__empty-copy">
              Cards, sections and portals appear here as a read-only preview.
            </p>
          </div>
        </div>
      ) : null}
      <div className="scene-board__outline">
        <SceneOutline
          items={outlineItems}
          activeId={activeOutlineId ?? scene.root.key}
          open={outlineOpen}
          onToggleOpen={() => setOutlineOpen((open) => !open)}
          onSelect={focusOutlineItem}
          onToggleExpand={toggleOutlineItem}
        />
      </div>
    </>
  );
}
