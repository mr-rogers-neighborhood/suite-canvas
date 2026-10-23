import type { Board, Card, Section, WorkspaceDocument } from "@suite/graph";
import { sectionMovePlan } from "@suite/graph";
import { buildScene, type Scene } from "@suite/scene";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EphemeralStore } from "loro-crdt";
import { useCallback } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toPeerPresence } from "../collab/peerProjection";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { SceneLayer } from "./SceneLayer";
import { type SceneSectionMovePlan, useSceneInteraction } from "./useSceneInteraction";

const VIEWPORT = { x: -4000, y: -4000, width: 8000, height: 8000 };

interface Fixture {
  readonly workspace: WorkspaceDocument;
  readonly root: Board;
  readonly cardA: Card;
  readonly cardB: Card;
  readonly section: Section;
  readonly scene: Scene;
}

let run = 0;

/**
 * One board with two cards and a far-away section, so a press can only land on
 * the instance under test. Everything publishes in board space, which for the
 * root board is also page space.
 */
function fixture(): Fixture {
  run += 1;
  const workspace = useCanvasStore.getState().workspace;
  const suffix = `p${run}`;
  const root = workspace.createBoard({ id: `presence-root-${suffix}`, name: "Presence root" });
  const cardA = workspace.createCard({
    id: `presence-a-${suffix}`,
    typeId: "note",
    boardId: root.id,
    position: { x: 0, y: 0 },
  });
  const cardB = workspace.createCard({
    id: `presence-b-${suffix}`,
    typeId: "note",
    boardId: root.id,
    position: { x: 300, y: 0 },
  });
  const section = workspace.createSection({
    id: `presence-section-${suffix}`,
    boardId: root.id,
    title: "Group",
    x: 1000,
    y: 1000,
    width: 600,
    height: 400,
  });

  const placements = workspace
    .listPlacements()
    .filter((placement) => placement.boardId === root.id);
  const scene = buildScene({
    boards: [{ id: root.id, name: root.name }],
    cards: [cardA, cardB].map((card) => ({
      id: card.id,
      primaryTypeId: card.primaryTypeId,
      properties: card.properties,
      connectors: card.connectors,
    })),
    placements: placements.map((placement) => ({
      boardId: placement.boardId,
      cardId: placement.cardId,
      x: placement.x,
      y: placement.y,
      z: placement.z,
    })),
    sections: workspace.listSections(root.id).map((entry) => ({
      id: entry.id,
      boardId: entry.boardId,
      title: entry.title,
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: entry.height,
      z: entry.z,
    })),
    rootBoardId: root.id,
    camera: { x: 0, y: 0, zoom: 1 },
    titles: Object.fromEntries([cardA, cardB].map((card) => [card.id, card.id])),
  });

  return { workspace, root, cardA, cardB, section, scene };
}

function Harness({
  scene,
  workspace,
  canEditLayout = true,
}: {
  scene: Scene;
  workspace: WorkspaceDocument;
  canEditLayout?: boolean;
}) {
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

  const interaction = useSceneInteraction({
    scene,
    canEditLayout,
    workspace,
    planSectionMove,
  });

  return (
    <>
      <div data-testid="scene-surface" {...interaction.handlers} />
      <SceneLayer
        scene={scene}
        viewport={VIEWPORT}
        selectedIds={interaction.selectedIds}
        selectedSectionId={interaction.selectedSectionId}
        overrides={interaction.overrides}
        marquee={interaction.marquee}
        canEditLayout={canEditLayout}
      />
    </>
  );
}

/**
 * Stands in for the Loro awareness store the real app binds: it records every
 * published state map, which is exactly what peers would project.
 */
interface FakeAwareness {
  readonly states: Map<string, Record<string, unknown>>;
  readonly store: EphemeralStore;
}

function fakeAwareness(): FakeAwareness {
  const states = new Map<string, Record<string, unknown>>();
  const store = {
    set: (peerId: string, state: Record<string, unknown>) => {
      states.set(peerId, { ...state });
    },
    subscribe: () => () => {},
    getAllStates: () => Object.fromEntries(states),
  };
  return { states, store: store as unknown as EphemeralStore };
}

let awareness: FakeAwareness;

/** Every interaction field nulled first, so the pointer publisher is not muted. */
function resetPublished(): void {
  const store = usePresenceStore.getState();
  store.setDragging(null);
  store.setSectionDrag(null);
  store.setSectionResize(null);
  store.setResizing(null);
  store.setSelectionBox(null);
  store.setSelection(null);
  store.setPointer(null);
}

function published(): Record<string, unknown> {
  return awareness.states.get("self") ?? {};
}

/** The state as a peer projects it, which fills in the single-drag id set. */
function publishedPeer() {
  return toPeerPresence("self", published());
}

beforeEach(() => {
  awareness = fakeAwareness();
  resetPublished();
  // `bind` keeps a process-lifetime sync timer; these tests own it explicitly.
  const interval = vi
    .spyOn(globalThis, "setInterval")
    .mockReturnValue(1 as unknown as ReturnType<typeof setInterval>);
  usePresenceStore.getState().bind(awareness.store, "self");
  interval.mockRestore();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useUiStore.setState({ selectedNodeIds: [], selectedSectionId: null, selectedEdgeIds: [] });
  usePresenceStore.setState({ bound: false, presenceStore: null, peers: {} });
});

function surface(): HTMLElement {
  return screen.getByTestId("scene-surface");
}

function press(target: Element, point: { x: number; y: number }, shiftKey = false): void {
  fireEvent.pointerDown(target, {
    clientX: point.x,
    clientY: point.y,
    button: 0,
    pointerId: 1,
    shiftKey,
  });
}

function moveTo(target: Element, point: { x: number; y: number }): void {
  fireEvent.pointerMove(target, { clientX: point.x, clientY: point.y, pointerId: 1 });
}

function release(target: Element, point: { x: number; y: number }): void {
  fireEvent.pointerUp(target, {
    clientX: point.x,
    clientY: point.y,
    button: 0,
    pointerId: 1,
  });
}

describe("scene presence", () => {
  it("should publish the pointer in page space while hovering", () => {
    const { scene, workspace } = fixture();
    render(<Harness scene={scene} workspace={workspace} />);

    moveTo(surface(), { x: 50, y: 60 });

    expect(published().pointer).toEqual({ x: 50, y: 60 });
  });

  it("should publish the dragged card set and clear it on release", () => {
    const { scene, workspace, root, cardA } = fixture();
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 40, y: 40 });
    moveTo(surface(), { x: 90, y: 70 });

    expect(publishedPeer().dragging).toMatchObject({
      nodeId: cardA.id,
      position: { x: 50, y: 30 },
      nodeIds: [cardA.id],
      boardId: root.id,
    });

    release(surface(), { x: 90, y: 70 });
    expect(published().dragging).toBeNull();
  });

  it("should publish every canonical id in a multi-card drag", () => {
    const { scene, workspace, cardA, cardB } = fixture();
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 40, y: 40 });
    release(surface(), { x: 40, y: 40 });
    press(surface(), { x: 340, y: 40 }, true);
    release(surface(), { x: 340, y: 40 });
    press(surface(), { x: 40, y: 40 });
    moveTo(surface(), { x: 70, y: 60 });

    expect(publishedPeer().dragging).toMatchObject({
      nodeId: cardA.id,
      position: { x: 30, y: 20 },
      nodeIds: [cardA.id, cardB.id],
    });
  });

  it("should publish a card resize and clear it on release", () => {
    const { scene, workspace, root, cardA } = fixture();
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 40, y: 40 });
    release(surface(), { x: 40, y: 40 });
    // The 224x160 card at the origin puts its south-east handle at (224, 160).
    press(surface(), { x: 224, y: 160 });
    moveTo(surface(), { x: 244, y: 180 });

    expect(published().resizing).toEqual({
      nodeId: cardA.id,
      boardId: root.id,
      position: { x: 0, y: 0 },
      width: 244,
      height: 180,
    });

    release(surface(), { x: 244, y: 180 });
    expect(published().resizing).toBeNull();
  });

  it("should publish a section resize in board space", () => {
    const { scene, workspace, section } = fixture();
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 1010, y: 1010 });
    release(surface(), { x: 1010, y: 1010 });
    press(surface(), { x: 1600, y: 1400 });
    moveTo(surface(), { x: 1620, y: 1420 });

    expect(published().sectionResize).toEqual({
      sectionId: section.id,
      position: { x: 1000, y: 1000 },
      width: 620,
      height: 420,
    });

    release(surface(), { x: 1620, y: 1420 });
    expect(published().sectionResize).toBeNull();
  });

  it("should publish the marquee box and the selection it leaves behind", () => {
    const { scene, workspace, cardA, cardB } = fixture();
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 560, y: 300 });
    moveTo(surface(), { x: -40, y: -40 });

    expect(published().selectionBox).toEqual({ x: -40, y: -40, width: 600, height: 340 });

    release(surface(), { x: -40, y: -40 });
    expect(published().selectionBox).toBeNull();
    expect(published().selection).toMatchObject({ nodeIds: [cardA.id, cardB.id] });
  });

  it("should publish the scene selection and publish null when it clears", () => {
    const { scene, workspace, cardA } = fixture();
    render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 40, y: 40 });
    release(surface(), { x: 40, y: 40 });
    expect(published().selection).toMatchObject({ nodeIds: [cardA.id] });

    press(surface(), { x: 900, y: 600 });
    release(surface(), { x: 900, y: 600 });
    expect(published().selection).toBeNull();
  });

  it("should clear presence when the surface unmounts mid-gesture", () => {
    const { scene, workspace } = fixture();
    const { unmount } = render(<Harness scene={scene} workspace={workspace} />);

    press(surface(), { x: 40, y: 40 });
    moveTo(surface(), { x: 90, y: 70 });
    expect(published().dragging).not.toBeNull();

    unmount();
    expect(published().dragging).toBeNull();
    expect(published().pointer).toBeNull();
  });

  it("should publish a viewer's selection and marquee but never a drag", () => {
    const { scene, workspace, cardA, cardB } = fixture();
    render(<Harness scene={scene} workspace={workspace} canEditLayout={false} />);

    press(surface(), { x: 40, y: 40 });
    moveTo(surface(), { x: 120, y: 120 });

    expect(published().dragging).toBeNull();
    expect(published().resizing).toBeNull();
    expect(published().selection).toMatchObject({ nodeIds: [cardA.id] });

    release(surface(), { x: 120, y: 120 });
    // A reader still drags a marquee; peers watch the box and the selection.
    press(surface(), { x: 560, y: 300 });
    moveTo(surface(), { x: -40, y: -40 });
    expect(published().selectionBox).toEqual({ x: -40, y: -40, width: 600, height: 340 });
    release(surface(), { x: -40, y: -40 });
    expect(published().dragging).toBeNull();
    expect(published().selection).toMatchObject({ nodeIds: [cardA.id, cardB.id] });
  });
});
