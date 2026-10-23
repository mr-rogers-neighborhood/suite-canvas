import { PORTAL_BOARD_FIELD_ID, PORTAL_TYPE_ID } from "@suite/graph";
import { buildScene, DEFAULT_PORTAL_CONFIG, type Scene } from "@suite/scene";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
