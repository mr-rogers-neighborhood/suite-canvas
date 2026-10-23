import type { Board, Card, GraphEdge, Section, WorkspaceDocument } from "@suite/graph";
import { sectionMovePlan } from "@suite/graph";
import { buildScene, DEFAULT_PORTAL_CONFIG, type PortalInstance, type Scene } from "@suite/scene";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { SceneLayer } from "./SceneLayer";
import {
  type SceneConnectorCreate,
  type SceneSectionMovePlan,
  useSceneInteraction,
} from "./useSceneInteraction";

const VIEWPORT = { x: -4000, y: -4000, width: 8000, height: 8000 };

interface Fixture {
  readonly workspace: WorkspaceDocument;
  readonly root: Board;
  readonly target: Board;
  readonly cardA: Card;
  readonly cardB: Card;
  readonly cardChild: Card;
  readonly cardOther: Card;
  readonly portal: Card;
  readonly scene: Scene;
  readonly portalInstance: PortalInstance;
}

let run = 0;

/**
 * A real workspace plus a scene projected from the same ids and geometry, so a
 * commit can be verified against canonical state instead of a mock.
 *
 * Root:   card A (0,0) 224x160, card B (300,0), portal (600,0) 300x240 -> target.
 * Target: two cards stacked, which gives the portal a ~0.5 fit scale.
 */
function fixture(zoom = 1): Fixture {
  run += 1;
  const workspace = useCanvasStore.getState().workspace;
  const suffix = `s${run}`;
  const rootId = `root-${suffix}`;
  const targetId = `target-${suffix}`;
  const cardAId = `card-a-${suffix}`;
  const cardBId = `card-b-${suffix}`;
  const childId = `card-child-${suffix}`;
  const otherId = `card-other-${suffix}`;
  const portalId = `card-portal-${suffix}`;

  const root = workspace.createBoard({ id: rootId, name: "Root" });
  const target = workspace.createBoard({ id: targetId, name: "Target" });
  const cardA = workspace.createCard({
    id: cardAId,
    typeId: "note",
    boardId: root.id,
    position: { x: 0, y: 0 },
  });
  const cardB = workspace.createCard({
    id: cardBId,
    typeId: "note",
    boardId: root.id,
    position: { x: 300, y: 0 },
  });
  const cardChild = workspace.createCard({
    id: childId,
    typeId: "note",
    boardId: target.id,
    position: { x: 0, y: 0 },
  });
  const cardOther = workspace.createCard({
    id: otherId,
    typeId: "note",
    boardId: target.id,
    position: { x: 0, y: 280 },
  });
  const portal = workspace.createPortalCard({
    id: portalId,
    boardId: root.id,
    position: { x: 600, y: 0 },
    targetBoardId: target.id,
    size: { width: 300, height: 240 },
  });

  const scene = buildScene({
    boards: [
      { id: root.id, name: root.name },
      { id: target.id, name: target.name },
    ],
    cards: [cardA, cardB, cardChild, cardOther, portal].map((card) => ({
      id: card.id,
      primaryTypeId: card.primaryTypeId,
      properties: card.properties,
      connectors: card.connectors,
    })),
    placements: [
      { boardId: root.id, cardId: cardA.id, x: 0, y: 0, z: 0 },
      { boardId: root.id, cardId: cardB.id, x: 300, y: 0, z: 1 },
      {
        boardId: root.id,
        cardId: portal.id,
        x: 600,
        y: 0,
        z: 2,
        width: 300,
        height: 240,
      },
      { boardId: target.id, cardId: cardChild.id, x: 0, y: 0, z: 0 },
      { boardId: target.id, cardId: cardOther.id, x: 0, y: 280, z: 1 },
    ],
    rootBoardId: root.id,
    camera: { x: 0, y: 0, zoom },
    titles: Object.fromEntries(
      [cardA, cardB, cardChild, cardOther, portal].map((card) => [card.id, card.id]),
    ),
    config: {
      portal: {
        ...DEFAULT_PORTAL_CONFIG,
        expansionScale: 0.1,
        collapseScale: 0.05,
        minScreenSize: 0,
        dwellMs: 0,
      },
    },
  });

  const portalInstance = scene.portals[0];
  if (!portalInstance) throw new Error("fixture portal did not project");

  return {
    workspace,
    root,
    target,
    cardA,
    cardB,
    cardChild,
    cardOther,
    portal,
    scene,
    portalInstance,
  };
}

interface SectionFixture {
  readonly workspace: WorkspaceDocument;
  readonly root: Board;
  readonly outer: Section;
  readonly inner: Section;
  readonly cardIn: Card;
  readonly cardInner: Card;
  readonly cardOut: Card;
  readonly edge: GraphEdge;
  readonly scene: Scene;
}

let sectionRun = 0;

/**
 * One board with a section, a section nested in it and their member cards,
 * plus a straight edge between two cards. Every box sits far from the origin so
 * a press cannot land on more than the instance under test.
 *
 * Outer (1000,1000) 600x400 holds `cardIn`; Inner (1200,1200) 300x160 is
 * contained by Outer and holds `cardInner`; `cardOut` sits outside both.
 */
function sectionFixture(): SectionFixture {
  sectionRun += 1;
  const workspace = useCanvasStore.getState().workspace;
  const suffix = `sec${sectionRun}`;
  const root = workspace.createBoard({ id: `section-root-${suffix}`, name: "Section root" });
  const cardIn = workspace.createCard({
    id: `card-in-${suffix}`,
    typeId: "note",
    boardId: root.id,
    position: { x: 1020, y: 1040 },
  });
  const cardInner = workspace.createCard({
    id: `card-inner-${suffix}`,
    typeId: "note",
    boardId: root.id,
    position: { x: 1250, y: 1230 },
  });
  const cardOut = workspace.createCard({
    id: `card-out-${suffix}`,
    typeId: "note",
    boardId: root.id,
    position: { x: 2200, y: 1000 },
  });
  const outer = workspace.createSection({
    id: `outer-${suffix}`,
    boardId: root.id,
    title: "Outer",
    x: 1000,
    y: 1000,
    width: 600,
    height: 400,
  });
  const inner = workspace.createSection({
    id: `inner-${suffix}`,
    boardId: root.id,
    title: "Inner",
    x: 1200,
    y: 1200,
    width: 300,
    height: 160,
  });
  const edge = workspace.addEdge({
    boardId: root.id,
    source: cardIn.id,
    target: cardOut.id,
  });
  if (!edge) throw new Error("fixture edge did not create");
  workspace.setEdgePath(edge.id, "straight");

  const scene = buildScene({
    boards: [{ id: root.id, name: root.name }],
    cards: [cardIn, cardInner, cardOut].map((card) => ({
      id: card.id,
      primaryTypeId: card.primaryTypeId,
      properties: card.properties,
      connectors: card.connectors,
    })),
    placements: workspace
      .listPlacements()
      .filter((placement) => placement.boardId === root.id)
      .map((placement) => ({
        boardId: placement.boardId,
        cardId: placement.cardId,
        x: placement.x,
        y: placement.y,
        z: placement.z,
        ...(placement.width === undefined ? {} : { width: placement.width }),
        ...(placement.height === undefined ? {} : { height: placement.height }),
      })),
    sections: workspace.listSections(root.id).map((section) => ({
      id: section.id,
      boardId: section.boardId,
      title: section.title,
      x: section.x,
      y: section.y,
      width: section.width,
      height: section.height,
      z: section.z,
    })),
    edges: [
      {
        id: edge.id,
        boardId: edge.boardId,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        path: edge.path,
      },
    ],
    rootBoardId: root.id,
    camera: { x: 0, y: 0, zoom: 1 },
    titles: Object.fromEntries([cardIn, cardInner, cardOut].map((card) => [card.id, card.id])),
  });

  return { workspace, root, outer, inner, cardIn, cardInner, cardOut, edge, scene };
}

function Harness({
  scene,
  workspace,
  canEditLayout = true,
  onFocusPortal,
  canCreate = false,
}: {
  scene: Scene;
  workspace: WorkspaceDocument;
  canEditLayout?: boolean;
  onFocusPortal?: (portal: PortalInstance) => void;
  canCreate?: boolean;
}) {
  // Mirrors the shell: membership comes from stored graph data, so a section
  // drag carries exactly what the document says it owns.
  const planSectionMove = useCallback(
    (sectionId: string): SceneSectionMovePlan | null => {
      const section = workspace.getSection(sectionId);
      if (!section) return null;
      const plan = sectionMovePlan(
        sectionId,
        workspace.listSections(section.boardId),
        workspace.listPlacements().filter((placement) => placement.boardId === section.boardId),
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
    [workspace],
  );

  const connectorsFor = useCallback(
    (cardId: string) => workspace.getCard(cardId)?.connectors ?? [],
    [workspace],
  );

  const createConnector = useCallback(
    (input: SceneConnectorCreate) => {
      workspace.addEdge({
        boardId: input.boardId,
        source: input.sourceCardId,
        target: input.targetCardId,
        ...(input.sourceConnectorId === null ? {} : { sourceConnector: input.sourceConnectorId }),
        ...(input.targetConnectorId === null ? {} : { targetConnector: input.targetConnectorId }),
      });
    },
    [workspace],
  );

  const interaction = useSceneInteraction({
    scene,
    canEditLayout,
    workspace,
    planSectionMove,
    connectorsFor,
    ...(onFocusPortal ? { onFocusPortal } : {}),
    ...(canCreate ? { createConnector } : {}),
  });
  return (
    <>
      <div data-testid="scene-surface" {...interaction.handlers} />
      <SceneLayer
        scene={scene}
        viewport={VIEWPORT}
        selectedIds={interaction.selectedIds}
        selectedSectionId={interaction.selectedSectionId}
        selectedEdgeIds={interaction.selectedEdgeIds}
        overrides={interaction.overrides}
        marquee={interaction.marquee}
        connectorHandles={interaction.connectorHandles}
        connectorDrag={interaction.connectorDrag}
        canEditLayout={canEditLayout}
      />
    </>
  );
}

function press(
  target: Element,
  point: { x: number; y: number },
  options: { shiftKey?: boolean } = {},
): void {
  fireEvent.pointerDown(target, {
    clientX: point.x,
    clientY: point.y,
    button: 0,
    pointerId: 1,
    ...options,
  });
}

function moveTo(target: Element, point: { x: number; y: number }): void {
  fireEvent.pointerMove(target, {
    clientX: point.x,
    clientY: point.y,
    pointerId: 1,
  });
}

function release(target: Element, point: { x: number; y: number }): void {
  fireEvent.pointerUp(target, {
    clientX: point.x,
    clientY: point.y,
    button: 0,
    pointerId: 1,
  });
}

function surface(): HTMLElement {
  return screen.getByTestId("scene-surface");
}

function selectedIds(): string[] {
  return useUiStore.getState().selectedNodeIds;
}

afterEach(() => {
  cleanup();
  // Spies wrap the shared workspace instance; without a restore the next test
  // would reuse the same mock and inherit its call history.
  vi.restoreAllMocks();
  useUiStore.setState({ selectedNodeIds: [], selectedSectionId: null, selectedEdgeIds: [] });
});

describe("useSceneInteraction", () => {
  it("should select a card on press and toggle it with shift", () => {
    const { scene, workspace, cardA, cardB } = fixture();
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 40, y: 40 });
    release(surface(), { x: 40, y: 40 });
    expect(selectedIds()).toEqual([cardA.id]);
    expect(
      document.querySelector(`[data-testid="scene-selection-outline"][data-card-id="${cardA.id}"]`),
    ).not.toBeNull();

    press(surface(), { x: 340, y: 40 }, { shiftKey: true });
    release(surface(), { x: 340, y: 40 });
    expect(selectedIds()).toEqual([cardA.id, cardB.id]);

    press(surface(), { x: 40, y: 40 }, { shiftKey: true });
    release(surface(), { x: 40, y: 40 });
    expect(selectedIds()).toEqual([cardB.id]);
  });

  it("should marquee select cards and clear them on an empty click", () => {
    const { scene, workspace, cardA, cardB } = fixture();
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 560, y: 300 });
    moveTo(surface(), { x: -40, y: -40 });
    expect(screen.getByTestId("scene-marquee")).toBeInTheDocument();
    expect(selectedIds()).toEqual([cardA.id, cardB.id]);

    release(surface(), { x: -40, y: -40 });
    expect(screen.queryByTestId("scene-marquee")).not.toBeInTheDocument();
    expect(selectedIds()).toEqual([cardA.id, cardB.id]);

    press(surface(), { x: 900, y: 600 });
    release(surface(), { x: 900, y: 600 });
    expect(selectedIds()).toEqual([]);
  });

  it("should commit a multi-card drag once and leave canonical state moved", () => {
    const { scene, workspace, root, cardA, cardB } = fixture();
    const move = vi.spyOn(workspace, "movePlacements");
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 40, y: 40 });
    release(surface(), { x: 40, y: 40 });
    press(surface(), { x: 340, y: 40 }, { shiftKey: true });
    release(surface(), { x: 340, y: 40 });

    press(surface(), { x: 40, y: 40 });
    moveTo(surface(), { x: 90, y: 70 });
    release(surface(), { x: 90, y: 70 });

    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith(root.id, [
      { cardId: cardA.id, x: 50, y: 30 },
      { cardId: cardB.id, x: 350, y: 30 },
    ]);
    expect(workspace.getPlacement(root.id, cardA.id)).toMatchObject({ x: 50, y: 30 });
    expect(workspace.getPlacement(root.id, cardB.id)).toMatchObject({ x: 350, y: 30 });
  });

  it("should divide a drag inside a scaled portal by the board scale", () => {
    const { scene, workspace, target, cardChild, portalInstance } = fixture();
    const move = vi.spyOn(workspace, "movePlacements");
    const child = scene.cards.find((card) => card.cardId === cardChild.id);
    if (!child) throw new Error("child card missing");
    const scale = child.transform.scale;
    expect(scale).toBeLessThan(1);
    expect(portalInstance.expanded).toBe(true);

    render(<Harness scene={scene} workspace={workspace} />);

    // Keep clear of the portal header band, which owns the top of the frame.
    const start = {
      x: child.rect.x + child.rect.width / 2,
      y: child.rect.y + child.rect.height * 0.75,
    };
    press(surface(), start);
    moveTo(surface(), { x: start.x + 40, y: start.y + 20 });
    release(surface(), { x: start.x + 40, y: start.y + 20 });

    expect(move).toHaveBeenCalledTimes(1);
    const [boardId, moves] = move.mock.calls[0] ?? [];
    expect(boardId).toBe(target.id);
    expect(moves).toHaveLength(1);
    const committed = moves?.[0];
    expect(committed?.cardId).toBe(cardChild.id);
    expect(committed?.x).toBeCloseTo(child.local.x + 40 / scale);
    expect(committed?.y).toBeCloseTo(child.local.y + 20 / scale);
    expect(workspace.getPlacement(target.id, cardChild.id)?.x).toBeCloseTo(
      child.local.x + 40 / scale,
    );
  });

  it("should not write anything for a click", () => {
    const { scene, workspace } = fixture();
    const move = vi.spyOn(workspace, "movePlacements");
    const resize = vi.spyOn(workspace, "updatePlacementGeometry");
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 40, y: 40 });
    moveTo(surface(), { x: 41, y: 41 });
    release(surface(), { x: 41, y: 41 });

    expect(move).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
  });

  it("should resize from a corner at camera zoom and commit once", () => {
    const { scene, workspace, root, cardA } = fixture(2);
    const resize = vi.spyOn(workspace, "updatePlacementGeometry");
    render(<Harness scene={scene} workspace={workspace} />);

    // Select: the card box is 224x160 in page space, so at zoom 2 its centre is
    // at screen (224, 160) and its south-east handle at (448, 320).
    press(surface(), { x: 224, y: 160 });
    release(surface(), { x: 224, y: 160 });
    expect(document.querySelectorAll('[data-testid="scene-resize-handle"]')).toHaveLength(8);

    press(surface(), { x: 448, y: 320 });
    moveTo(surface(), { x: 488, y: 340 });
    const face = document.querySelector<HTMLElement>(
      `[data-testid="scene-card"][data-card-id="${cardA.id}"]`,
    );
    // The live box is page space: +40/+20 screen at zoom 2 is +20/+10 page, and
    // nothing is committed until the pointer lifts.
    expect(face?.style.width).toBe("244px");
    expect(face?.style.height).toBe("170px");
    expect(resize).not.toHaveBeenCalled();

    release(surface(), { x: 488, y: 340 });

    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith(root.id, cardA.id, {
      x: 0,
      y: 0,
      width: 244,
      height: 170,
    });
    expect(workspace.getPlacement(root.id, cardA.id)).toMatchObject({ width: 244, height: 170 });
  });

  it("should resize from the north-west handle by moving the origin", () => {
    const { scene, workspace, root, cardA } = fixture();
    const resize = vi.spyOn(workspace, "updatePlacementGeometry");
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 40, y: 40 });
    release(surface(), { x: 40, y: 40 });
    press(surface(), { x: 0, y: 0 });
    moveTo(surface(), { x: -10, y: -20 });
    release(surface(), { x: -10, y: -20 });

    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith(root.id, cardA.id, {
      x: -10,
      y: -20,
      width: 234,
      height: 180,
    });
  });

  it("should select but never drag or resize for a viewer", () => {
    const { scene, workspace, cardA } = fixture();
    const move = vi.spyOn(workspace, "movePlacements");
    const resize = vi.spyOn(workspace, "updatePlacementGeometry");
    render(<Harness scene={scene} workspace={workspace} canEditLayout={false} />);

    press(surface(), { x: 40, y: 40 });
    moveTo(surface(), { x: 120, y: 120 });
    release(surface(), { x: 120, y: 120 });

    expect(selectedIds()).toEqual([cardA.id]);
    expect(move).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="scene-resize-handle"]')).toBeNull();
  });

  it("should focus a portal header on click but not after a drag", () => {
    const { scene, workspace, portalInstance } = fixture();
    const onFocusPortal = vi.fn();
    render(<Harness scene={scene} workspace={workspace} onFocusPortal={onFocusPortal} />);

    const header = { x: portalInstance.frame.x + 10, y: portalInstance.frame.y + 6 };
    press(surface(), header);
    release(surface(), header);
    expect(onFocusPortal).toHaveBeenCalledTimes(1);
    expect(onFocusPortal.mock.calls[0]?.[0]).toMatchObject({ key: portalInstance.key });

    onFocusPortal.mockClear();
    press(surface(), header);
    moveTo(surface(), { x: header.x + 60, y: header.y + 40 });
    release(surface(), { x: header.x + 60, y: header.y + 40 });
    expect(onFocusPortal).not.toHaveBeenCalled();
  });

  it("should clear the selection on Escape", () => {
    const { scene, workspace } = fixture();
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 40, y: 40 });
    release(surface(), { x: 40, y: 40 });
    expect(selectedIds()).toHaveLength(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(selectedIds()).toEqual([]);
  });

  it("should select a section on click and never start a card marquee", () => {
    const { scene, workspace, outer } = sectionFixture();
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 1010, y: 1010 });
    release(surface(), { x: 1010, y: 1010 });

    expect(useUiStore.getState().selectedSectionId).toBe(outer.id);
    expect(selectedIds()).toEqual([]);
    expect(
      document.querySelector(
        `[data-testid="scene-section"][data-section-id="${outer.id}"][data-selected="true"]`,
      ),
    ).not.toBeNull();

    press(surface(), { x: 1010, y: 1010 });
    moveTo(surface(), { x: 1060, y: 1030 });
    // A press that starts on a section drags it; it never paints a card marquee.
    expect(screen.queryByTestId("scene-marquee")).not.toBeInTheDocument();
    release(surface(), { x: 1060, y: 1030 });
  });

  it("should commit a section drag once, carrying contained sections and cards", () => {
    const { scene, workspace, root, outer, inner, cardIn, cardInner } = sectionFixture();
    const batch = vi.spyOn(workspace, "moveSectionsBatch");
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 1010, y: 1010 });
    moveTo(surface(), { x: 1060, y: 1030 });
    const section = document.querySelector<HTMLElement>(
      `[data-testid="scene-section"][data-section-id="${outer.id}"]`,
    );
    // The live box is page space; nothing is committed until the pointer lifts.
    expect(section?.style.left).toBe("1050px");
    expect(batch).not.toHaveBeenCalled();

    release(surface(), { x: 1060, y: 1030 });

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith({
      sections: [
        { id: outer.id, x: 1050, y: 1020 },
        { id: inner.id, x: 1250, y: 1220 },
      ],
      placements: [
        { boardId: root.id, cardId: cardIn.id, x: 1070, y: 1060 },
        { boardId: root.id, cardId: cardInner.id, x: 1300, y: 1250 },
      ],
    });
    expect(workspace.getSection(outer.id)).toMatchObject({ x: 1050, y: 1020 });
    expect(workspace.getSection(inner.id)).toMatchObject({ x: 1250, y: 1220 });
    expect(workspace.getPlacement(root.id, cardIn.id)).toMatchObject({ x: 1070, y: 1060 });
    expect(workspace.getPlacement(root.id, cardInner.id)).toMatchObject({ x: 1300, y: 1250 });
  });

  it("should resize a selected section and commit one geometry change", () => {
    const { scene, workspace, outer } = sectionFixture();
    const geometry = vi.spyOn(workspace, "updateSectionGeometry");
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 1010, y: 1010 });
    release(surface(), { x: 1010, y: 1010 });
    expect(document.querySelectorAll('[data-testid="scene-resize-handle"]')).toHaveLength(8);

    // Outer is page (1000,1000,600,400), so its south-east handle is (1600,1400).
    press(surface(), { x: 1600, y: 1400 });
    moveTo(surface(), { x: 1640, y: 1420 });
    expect(geometry).not.toHaveBeenCalled();
    release(surface(), { x: 1640, y: 1420 });

    expect(geometry).toHaveBeenCalledTimes(1);
    expect(geometry).toHaveBeenCalledWith(outer.id, {
      x: 1000,
      y: 1000,
      width: 640,
      height: 420,
    });
    expect(workspace.getSection(outer.id)).toMatchObject({ width: 640, height: 420 });
  });

  it("should keep card clicks above the section that contains them", () => {
    const { scene, workspace, cardIn } = sectionFixture();
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 1030, y: 1050 });
    release(surface(), { x: 1030, y: 1050 });

    expect(selectedIds()).toEqual([cardIn.id]);
    expect(useUiStore.getState().selectedSectionId).toBeNull();
  });

  it("should select an edge on click and highlight it", () => {
    const { scene, workspace, edge } = sectionFixture();
    const instance = scene.edges.find((entry) => entry.edgeId === edge.id);
    if (!instance) throw new Error("fixture edge missing from the scene");
    const middle = {
      x: (instance.from.x + instance.to.x) / 2,
      y: (instance.from.y + instance.to.y) / 2,
    };
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), middle);
    release(surface(), middle);

    expect(useUiStore.getState().selectedEdgeIds).toEqual([edge.id]);
    expect(selectedIds()).toEqual([]);
    const highlight = screen.getByTestId("scene-edge-selected");
    expect(highlight).toHaveAttribute("data-edge-id", edge.id);

    press(surface(), middle, { shiftKey: true });
    release(surface(), middle);
    expect(useUiStore.getState().selectedEdgeIds).toEqual([]);
    expect(screen.queryByTestId("scene-edge-selected")).not.toBeInTheDocument();
  });

  it("should create one edge when a connector handle is dragged onto another card", () => {
    const { scene, workspace, root, cardIn, cardOut, edge } = sectionFixture();
    const boardEdges = () => workspace.listEdges().filter((entry) => entry.boardId === root.id);
    const before = boardEdges().length;
    render(<Harness scene={scene} workspace={workspace} canCreate />);

    press(surface(), { x: 1030, y: 1050 });
    release(surface(), { x: 1030, y: 1050 });
    expect(document.querySelectorAll('[data-testid="scene-connector-handle"]')).toHaveLength(4);

    // `cardIn` is page (1020,1040,224,160); its east handle sits 12px outside.
    press(surface(), { x: 1256, y: 1120 });
    moveTo(surface(), { x: 1400, y: 1110 });
    expect(screen.getByTestId("scene-connector-drag")).toBeInTheDocument();
    moveTo(surface(), { x: 2312, y: 1080 });
    release(surface(), { x: 2312, y: 1080 });

    expect(screen.queryByTestId("scene-connector-drag")).not.toBeInTheDocument();
    const edges = boardEdges();
    expect(edges).toHaveLength(before + 1);
    // The fixture already links these two, so pick the edge this drop added.
    const created = edges.find((entry) => entry.id !== edge.id);
    expect(created).toBeDefined();
    expect(created?.boardId).toBe(root.id);
    expect(created?.source).toBe(cardIn.id);
    expect(created?.target).toBe(cardOut.id);
    expect(created?.sourceConnector).toEqual(expect.any(String));
    expect(created?.targetConnector).toEqual(expect.any(String));
  });

  it("should not offer connector handles to a session that cannot create content", () => {
    const { scene, workspace } = sectionFixture();
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 1030, y: 1050 });
    release(surface(), { x: 1030, y: 1050 });

    expect(document.querySelector('[data-testid="scene-connector-handle"]')).toBeNull();
  });
});
