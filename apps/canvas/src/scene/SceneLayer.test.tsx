import { type Card, PORTAL_BOARD_FIELD_ID, PORTAL_TYPE_ID } from "@suite/graph";
import { buildScene, DEFAULT_PORTAL_CONFIG, type Scene, transformRect } from "@suite/scene";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PeerPresence } from "../collab/presence";
import { SceneLayer } from "./SceneLayer";

const VIEWPORT = { x: -100, y: -100, width: 2400, height: 1600 };

function sceneFixture(zoom: number): Scene {
  return buildScene({
    boards: [
      { id: "root", name: "Root" },
      { id: "target", name: "Target" },
    ],
    cards: [
      { id: "root-note", primaryTypeId: "note", properties: {} },
      {
        id: "root-portal",
        primaryTypeId: PORTAL_TYPE_ID,
        properties: { [PORTAL_BOARD_FIELD_ID]: "target" },
      },
      {
        id: "missing-portal",
        primaryTypeId: PORTAL_TYPE_ID,
        properties: { [PORTAL_BOARD_FIELD_ID]: "gone" },
      },
      { id: "child-note", primaryTypeId: "note", properties: {} },
      {
        id: "back-portal",
        primaryTypeId: PORTAL_TYPE_ID,
        properties: { [PORTAL_BOARD_FIELD_ID]: "root" },
      },
    ],
    placements: [
      { boardId: "root", cardId: "root-note", x: 0, y: 0, z: 0 },
      { boardId: "root", cardId: "root-portal", x: 300, y: 0, z: 1, width: 288, height: 256 },
      { boardId: "root", cardId: "missing-portal", x: 640, y: 0, z: 2, width: 220, height: 200 },
      { boardId: "target", cardId: "child-note", x: 0, y: 0, z: 0 },
      { boardId: "target", cardId: "back-portal", x: 300, y: 0, z: 1, width: 288, height: 256 },
    ],
    sections: [
      {
        id: "sec-group",
        boardId: "root",
        title: "Group",
        x: 0,
        y: 400,
        width: 420,
        height: 200,
        z: 0,
      },
    ],
    edges: [
      {
        id: "edge-1",
        boardId: "root",
        source: "root-note",
        target: "root-portal",
        kind: "references",
        path: "straight",
        label: "refs",
      },
    ],
    rootBoardId: "root",
    camera: { x: 0, y: 0, zoom },
    titles: {
      "root-note": "Root card",
      "root-portal": "Live target",
      "missing-portal": "Missing target",
      "child-note": "Child card",
      "back-portal": "Back to root",
    },
    config: { portal: { ...DEFAULT_PORTAL_CONFIG, dwellMs: 0 } },
  });
}

/** Root board plus one card placed on both boards, so it has two instances. */
function sharedSceneFixture(zoom = 1): Scene {
  return buildScene({
    boards: [
      { id: "root", name: "Root" },
      { id: "target", name: "Target" },
    ],
    cards: [
      { id: "shared", primaryTypeId: "note", properties: {} },
      {
        id: "portal",
        primaryTypeId: PORTAL_TYPE_ID,
        properties: { [PORTAL_BOARD_FIELD_ID]: "target" },
      },
    ],
    placements: [
      { boardId: "root", cardId: "shared", x: 0, y: 0, z: 0 },
      { boardId: "root", cardId: "portal", x: 400, y: 0, z: 1, width: 320, height: 260 },
      { boardId: "target", cardId: "shared", x: 10, y: 20, z: 0 },
    ],
    rootBoardId: "root",
    camera: { x: 0, y: 0, zoom },
    titles: { shared: "Shared card", portal: "Live target" },
    config: { portal: { ...DEFAULT_PORTAL_CONFIG, dwellMs: 0 } },
  });
}

function peer(overrides: Partial<PeerPresence> = {}): PeerPresence {
  return {
    clientId: "peer-ada",
    board: "root",
    user: { name: "Ada", color: "#e11d48" },
    pointer: null,
    focus: null,
    dragging: null,
    selection: null,
    selectionBox: null,
    connector: null,
    resizing: null,
    sectionDrag: null,
    sectionResize: null,
    reconnect: null,
    connect: null,
    labelDrag: null,
    ...overrides,
  };
}

function pageBoxOf(element: Element): { left: string; top: string; width: string; height: string } {
  const style = (element as HTMLElement).style;
  return { left: style.left, top: style.top, width: style.width, height: style.height };
}

afterEach(cleanup);

describe("SceneLayer", () => {
  it("should render the target board live when a portal is expanded", () => {
    render(<SceneLayer scene={sceneFixture(1)} viewport={VIEWPORT} />);

    const portal = document.querySelector<HTMLElement>(
      '[data-testid="scene-portal"][data-card-id="root-portal"]',
    );
    expect(portal).toHaveAttribute("data-expanded", "true");
    const child = screen.getByTestId("scene-portal-child");
    expect(within(child).getByText("Child card")).toBeInTheDocument();
    expect(portal?.querySelector(":scope > .scene-portal__preview")).toBeNull();
  });

  it("should render an impostor while the portal is below the expansion gate", () => {
    render(<SceneLayer scene={sceneFixture(0.4)} viewport={VIEWPORT} />);

    const portal = document.querySelector<HTMLElement>(
      '[data-testid="scene-portal"][data-card-id="root-portal"]',
    );
    expect(portal).not.toBeNull();
    expect(portal).toHaveAttribute("data-expanded", "false");
    expect(within(portal as HTMLElement).getByTestId("scene-portal-impostor")).toBeInTheDocument();
    expect(screen.queryByTestId("scene-portal-child")).not.toBeInTheDocument();
  });

  it("should stop a portal cycle with a labelled stub", () => {
    render(<SceneLayer scene={sceneFixture(1)} viewport={VIEWPORT} />);

    const cycle = document.querySelector<HTMLElement>(
      '[data-testid="scene-portal"][data-cycle="true"]',
    );
    expect(cycle).not.toBeNull();
    expect(within(cycle as HTMLElement).getByTestId("scene-portal-impostor")).toBeInTheDocument();
    expect(within(cycle as HTMLElement).getAllByText("Cycle").length).toBeGreaterThan(0);
  });

  it("should label a portal whose target board is missing", () => {
    render(<SceneLayer scene={sceneFixture(1)} viewport={VIEWPORT} />);

    const missing = document.querySelector<HTMLElement>(
      '[data-testid="scene-portal"][data-target-missing="true"]',
    );
    expect(missing).not.toBeNull();
    expect(within(missing as HTMLElement).getAllByText("Unavailable board").length).toBeGreaterThan(
      0,
    );
  });

  it("should focus a portal without swapping the rendered scene", () => {
    const onFocusPortal = vi.fn();
    render(
      <SceneLayer scene={sceneFixture(0.4)} viewport={VIEWPORT} onFocusPortal={onFocusPortal} />,
    );

    const portal = document.querySelector<HTMLElement>(
      '[data-testid="scene-portal"][data-card-id="root-portal"]',
    );
    expect(portal).not.toBeNull();
    fireEvent.click(within(portal as HTMLElement).getByRole("button", { name: "Focus Target" }));

    expect(onFocusPortal).toHaveBeenCalledTimes(1);
    expect(onFocusPortal.mock.calls[0]?.[0]).toMatchObject({
      cardId: "root-portal",
      targetBoardId: "target",
    });
  });

  it("should not focus a portal whose target board is missing", () => {
    const onFocusPortal = vi.fn();
    render(
      <SceneLayer scene={sceneFixture(0.4)} viewport={VIEWPORT} onFocusPortal={onFocusPortal} />,
    );

    const missing = document.querySelector<HTMLElement>(
      '[data-testid="scene-portal"][data-card-id="missing-portal"]',
    );
    expect(missing).not.toBeNull();
    expect(within(missing as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
  });

  it("should render a whiteboard preview instead of placeholder lines", () => {
    const scene = buildScene({
      boards: [{ id: "root", name: "Root" }],
      cards: [{ id: "wb", primaryTypeId: "whiteboard", properties: {} }],
      placements: [{ boardId: "root", cardId: "wb", x: 0, y: 0, z: 0 }],
      rootBoardId: "root",
      camera: { x: 0, y: 0, zoom: 1 },
      titles: { wb: "Sketch" },
    });
    const card: Card = {
      id: "wb",
      createdAt: 0,
      updatedAt: 0,
      connectors: [],
      typeIds: ["whiteboard"],
      primaryTypeId: "whiteboard",
      tags: [],
      properties: {},
    };

    render(
      <SceneLayer
        scene={scene}
        viewport={VIEWPORT}
        cards={new Map([["wb", card]])}
        drawings={
          new Map([["wb", { cardId: "wb", elements: [], order: [], version: 1, updatedAt: 0 }]])
        }
      />,
    );

    expect(screen.getByTestId("whiteboard-preview")).toBeInTheDocument();
    expect(screen.queryByText("Sketch")).toBeInTheDocument();
  });

  it("should outline every selected card and show handles for a single editor selection", () => {
    const scene = sceneFixture(1);
    render(
      <SceneLayer scene={scene} viewport={VIEWPORT} selectedIds={["root-note"]} canEditLayout />,
    );

    const outline = document.querySelector<HTMLElement>(
      '[data-testid="scene-selection-outline"][data-card-id="root-note"]',
    );
    expect(outline).not.toBeNull();
    expect(outline?.style.width).toBe("224px");
    expect(document.querySelectorAll('[data-testid="scene-resize-handle"]')).toHaveLength(8);
  });

  it("should hide resize handles for a viewer and for a multi-selection", () => {
    const scene = sceneFixture(1);
    const { rerender } = render(
      <SceneLayer scene={scene} viewport={VIEWPORT} selectedIds={["root-note"]} />,
    );
    expect(document.querySelector('[data-testid="scene-resize-handle"]')).toBeNull();

    rerender(
      <SceneLayer
        scene={scene}
        viewport={VIEWPORT}
        selectedIds={["root-note", "root-portal"]}
        canEditLayout
      />,
    );
    expect(document.querySelectorAll('[data-testid="scene-selection-outline"]')).toHaveLength(2);
    expect(document.querySelector('[data-testid="scene-resize-handle"]')).toBeNull();
  });

  it("should paint live overrides and the marquee without moving canonical state", () => {
    const scene = sceneFixture(1);
    const card = scene.cards.find((entry) => entry.cardId === "root-note");
    if (!card) throw new Error("root-note missing");
    const live = { x: card.rect.x + 40, y: card.rect.y + 20, width: 260, height: 180 };

    render(
      <SceneLayer
        scene={scene}
        viewport={VIEWPORT}
        selectedIds={["root-note"]}
        canEditLayout
        overrides={new Map([[card.key, live]])}
        marquee={{ x: 10, y: 10, width: 60, height: 40 }}
      />,
    );

    const face = document.querySelector<HTMLElement>(
      '[data-testid="scene-card"][data-card-id="root-note"]',
    );
    expect(face?.style.left).toBe(`${live.x}px`);
    expect(face?.style.width).toBe("260px");
    expect(card.rect).toMatchObject({ width: 224 });
    expect(screen.getByTestId("scene-marquee")).toBeInTheDocument();
    const outline = document.querySelector<HTMLElement>(
      '[data-testid="scene-selection-outline"][data-card-id="root-note"]',
    );
    expect(outline?.style.left).toBe(`${live.x}px`);
  });

  it("should highlight a selected edge and keep its label readable", () => {
    const { rerender } = render(<SceneLayer scene={sceneFixture(1)} viewport={VIEWPORT} />);
    expect(screen.queryByTestId("scene-edge-selected")).not.toBeInTheDocument();
    expect(screen.getByTestId("scene-edge-label")).toHaveTextContent("refs");

    rerender(
      <SceneLayer scene={sceneFixture(1)} viewport={VIEWPORT} selectedEdgeIds={["edge-1"]} />,
    );
    expect(screen.getByTestId("scene-edge-selected")).toHaveAttribute("data-edge-id", "edge-1");
  });

  it("should mark a selected section and only handle it for an editor", () => {
    const { rerender } = render(
      <SceneLayer scene={sceneFixture(1)} viewport={VIEWPORT} selectedSectionId="sec-group" />,
    );
    const section = document.querySelector<HTMLElement>(
      '[data-testid="scene-section"][data-section-id="sec-group"]',
    );
    expect(section).toHaveAttribute("data-selected", "true");
    expect(document.querySelector('[data-testid="scene-resize-handle"]')).toBeNull();

    rerender(
      <SceneLayer
        scene={sceneFixture(1)}
        viewport={VIEWPORT}
        selectedSectionId="sec-group"
        canEditLayout
      />,
    );
    expect(document.querySelectorAll('[data-testid="scene-resize-handle"]')).toHaveLength(8);
  });

  it("should render connector handles and the live connector line", () => {
    const handle = {
      key: "card:e",
      instanceKey: "root-note",
      cardId: "root-note",
      boardId: "root",
      connectorId: "connector-e",
      side: "e" as const,
      point: { x: 236, y: 80 },
      rect: { x: 231, y: 75, width: 10, height: 10 },
    };
    render(
      <SceneLayer
        scene={sceneFixture(1)}
        viewport={VIEWPORT}
        selectedIds={["root-note"]}
        canEditLayout
        connectorHandles={[handle]}
        connectorDrag={{ from: { x: 236, y: 80 }, to: { x: 300, y: 120 } }}
      />,
    );

    const rendered = screen.getByTestId("scene-connector-handle");
    expect(rendered).toHaveAttribute("data-side", "e");
    expect(rendered).toHaveAttribute("data-connector-id", "connector-e");
    expect(screen.getByTestId("scene-connector-drag")).toBeInTheDocument();
  });

  it("should cull instances outside the page-space viewport", () => {
    render(
      <SceneLayer
        scene={sceneFixture(1)}
        viewport={{ x: 10_000, y: 10_000, width: 100, height: 100 }}
      />,
    );

    expect(screen.queryByTestId("scene-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scene-portal")).not.toBeInTheDocument();
  });
  it("should outline every instance of a card a peer selected", () => {
    const scene = sharedSceneFixture();
    render(
      <SceneLayer
        scene={scene}
        viewport={VIEWPORT}
        peers={[peer({ selection: { nodeIds: ["shared"] } })]}
      />,
    );

    const outlines = document.querySelectorAll<HTMLElement>(
      '[data-testid="scene-peer-selection"][data-card-id="shared"]',
    );
    expect(outlines).toHaveLength(2);
    for (const instance of scene.cards.filter((card) => card.cardId === "shared")) {
      const expected = {
        left: `${instance.rect.x}px`,
        top: `${instance.rect.y}px`,
        width: `${instance.rect.width}px`,
        height: `${instance.rect.height}px`,
      };
      expect([...outlines].map(pageBoxOf)).toContainEqual(expected);
    }
    expect(outlines[0]?.getAttribute("data-peer-name")).toBe("Ada");
    expect(outlines[0]?.style.borderColor).not.toBe("");
  });

  it("should clip a peer pointer to the portal it is inside", () => {
    const scene = sharedSceneFixture();
    const portal = scene.portals[0];
    if (!portal) throw new Error("portal missing");
    expect(portal.expanded).toBe(true);

    render(
      <SceneLayer
        scene={scene}
        viewport={VIEWPORT}
        peers={[peer({ pointer: { x: portal.frame.x + 40, y: portal.frame.y + 50 } })]}
      />,
    );

    const dot = screen.getByTestId("scene-peer-pointer");
    expect(pageBoxOf(dot)).toEqual({
      left: `${portal.frame.x}px`,
      top: `${portal.frame.y}px`,
      width: `${portal.frame.width}px`,
      height: `${portal.frame.height}px`,
    });
    const point = dot.querySelector<HTMLElement>(".scene-peer-pointer__dot");
    expect(point?.style.left).toBe("40px");
    expect(point?.style.top).toBe("50px");
  });

  it("should paint a free peer pointer in page space and hide one over a stub", () => {
    const { rerender } = render(
      <SceneLayer
        scene={sharedSceneFixture()}
        viewport={VIEWPORT}
        peers={[peer({ pointer: { x: -60, y: 500 } })]}
      />,
    );

    const dot = screen.getByTestId("scene-peer-pointer");
    expect(pageBoxOf(dot)).toMatchObject({ left: "-60px", top: "500px" });

    // Below the expansion gate the portal is a stub, so its content (and the
    // peer's pointer over it) is not shown; the frame's own box is not content.
    const collapsed = sharedSceneFixture(0.2);
    const portal = collapsed.portals[0];
    if (!portal) throw new Error("portal missing");
    expect(portal.expanded).toBe(false);
    rerender(
      <SceneLayer
        scene={collapsed}
        viewport={VIEWPORT}
        peers={[peer({ pointer: { x: portal.frame.x + 10, y: portal.frame.y + 10 } })]}
      />,
    );
    expect(screen.queryByTestId("scene-peer-pointer")).not.toBeInTheDocument();
  });

  it("should place a peer drag ghost on the board they are dragging", () => {
    const scene = sharedSceneFixture();
    const child = scene.cards.find((card) => card.cardId === "shared" && card.boardId === "target");
    if (!child) throw new Error("child instance missing");

    render(
      <SceneLayer
        scene={scene}
        viewport={VIEWPORT}
        peers={[
          peer({
            dragging: {
              nodeId: "shared",
              boardId: "target",
              position: { x: 40, y: 60 },
              nodeIds: ["shared"],
            },
          }),
        ]}
      />,
    );

    const ghosts = document.querySelectorAll<HTMLElement>(
      '[data-testid="scene-peer-ghost"][data-kind="drag"]',
    );
    expect(ghosts).toHaveLength(1);
    const expected = transformRect(child.transform, {
      x: 40,
      y: 60,
      width: child.local.width,
      height: child.local.height,
    });
    expect(pageBoxOf(ghosts[0] as HTMLElement)).toEqual({
      left: `${expected.x}px`,
      top: `${expected.y}px`,
      width: `${expected.width}px`,
      height: `${expected.height}px`,
    });
    expect(screen.getByTestId("peer-name-tag")).toHaveTextContent("Ada");
  });

  it("should fall back to the peer's board when a drag carries no board id", () => {
    const scene = sharedSceneFixture();
    const root = scene.cards.find((card) => card.cardId === "shared" && card.boardId === "root");
    if (!root) throw new Error("root instance missing");

    render(
      <SceneLayer
        scene={scene}
        viewport={VIEWPORT}
        peers={[
          peer({
            dragging: { nodeId: "shared", position: { x: 40, y: 60 }, nodeIds: ["shared"] },
          }),
        ]}
      />,
    );

    const ghost = document.querySelector<HTMLElement>('[data-testid="scene-peer-ghost"]');
    expect(ghost?.style.left).toBe(`${root.transform.x + 40 * root.transform.scale}px`);
    expect(ghost?.style.top).toBe(`${root.transform.y + 60 * root.transform.scale}px`);
  });

  it("should draw a peer's resize and a section resize ghost", () => {
    const { rerender } = render(
      <SceneLayer
        scene={sharedSceneFixture()}
        viewport={VIEWPORT}
        peers={[
          peer({
            resizing: {
              nodeId: "shared",
              boardId: "root",
              position: { x: 30, y: 40 },
              width: 300,
              height: 200,
            },
          }),
        ]}
      />,
    );

    const resize = document.querySelector<HTMLElement>(
      '[data-testid="scene-peer-ghost"][data-kind="resize"]',
    );
    expect(pageBoxOf(resize as HTMLElement)).toEqual({
      left: "30px",
      top: "40px",
      width: "300px",
      height: "200px",
    });

    rerender(
      <SceneLayer
        scene={sceneFixture(1)}
        viewport={VIEWPORT}
        peers={[
          peer({
            sectionResize: {
              sectionId: "sec-group",
              position: { x: 10, y: 420 },
              width: 400,
              height: 180,
            },
          }),
        ]}
      />,
    );

    const section = document.querySelector<HTMLElement>(
      '[data-testid="scene-peer-ghost"][data-kind="section-resize"]',
    );
    expect(pageBoxOf(section as HTMLElement)).toEqual({
      left: "10px",
      top: "420px",
      width: "400px",
      height: "180px",
    });
    expect(document.querySelectorAll('[data-testid="scene-peer-ghost"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="peer-name-tag"]')).toHaveLength(1);
  });
  it("should drop a pointer over a stub target so a share reveals nothing", () => {
    const scene = sceneFixture(1);
    const missing = scene.portals.find((portal) => portal.targetMissing);
    if (!missing) throw new Error("missing-target portal absent");
    render(
      <SceneLayer
        scene={scene}
        viewport={VIEWPORT}
        peers={[
          peer({
            pointer: { x: missing.frame.x + 20, y: missing.frame.y + 20 },
          }),
        ]}
      />,
    );

    expect(screen.queryByTestId("scene-peer-pointer")).not.toBeInTheDocument();
  });

  it("should ignore peers selecting something the projection does not contain", () => {
    render(
      <SceneLayer
        scene={sharedSceneFixture()}
        viewport={VIEWPORT}
        peers={[peer({ selection: { nodeIds: ["not-in-this-share"] } })]}
      />,
    );

    expect(screen.queryByTestId("scene-peer-selection")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scene-peers")).not.toBeInTheDocument();
  });
});
