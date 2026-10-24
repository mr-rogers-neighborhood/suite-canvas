import { afterEach, describe, expect, it } from "vitest";
import type { PeerPresence } from "../collab/presence";
import type { IcePresenceInstance } from "./icePresence";
import { createIcePresenceLayer, type IcePresenceLayerHandle } from "./icePresenceLayer";

const BOARD = "view-root";
const NESTED = "board-interviews";

function peer(patch: Partial<PeerPresence> = {}): PeerPresence {
  return {
    clientId: "peer-1",
    board: BOARD,
    boardOf: null,
    user: { name: "Ada", color: "#f43f5e" },
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
    ...patch,
  };
}

const CARD: IcePresenceInstance = {
  instanceKey: "card:card-a",
  cardId: "card-a",
  boardId: BOARD,
  rect: { x: 100, y: 80, width: 240, height: 160 },
};

interface Stage {
  readonly container: HTMLElement;
  readonly handle: IcePresenceLayerHandle;
  setPeers(peers: Record<string, PeerPresence>): void;
  setZoom(zoom: number): void;
}

const stages: Stage[] = [];

function stage(options: {
  peers?: Record<string, PeerPresence>;
  instances?: readonly IcePresenceInstance[];
  zoom?: number;
  anchorOf?: (cardId: string, connectorId: string) => { x: number; y: number } | null;
}): Stage {
  const container = document.createElement("div");
  document.body.append(container);
  const state = {
    peers: options.peers ?? {},
    zoom: options.zoom ?? 1,
    instances: options.instances ?? [CARD],
  };
  const handle = createIcePresenceLayer({
    container,
    peers: () => state.peers,
    boardId: BOARD,
    camera: () => ({ x: 0, y: 0, zoom: state.zoom }),
    instances: () => state.instances,
    boardName: (id) => (id === NESTED ? "Interviews" : undefined),
    viewport: () => ({ width: 1200, height: 800 }),
    ...(options.anchorOf === undefined ? {} : { anchorOf: options.anchorOf }),
  });
  container.append(handle.layer);
  const result: Stage = {
    container,
    handle,
    setPeers(next) {
      state.peers = next;
      handle.sync();
    },
    setZoom(zoom) {
      state.zoom = zoom;
      handle.sync();
    },
  };
  stages.push(result);
  return result;
}

afterEach(() => {
  for (const entry of stages.splice(0)) {
    entry.handle.dispose();
    entry.container.remove();
  }
});

const cursor = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-testid="ice-presence-cursor"]');

describe("createIcePresenceLayer", () => {
  it("hides itself while there is nobody to paint", () => {
    const { container, handle } = stage({});
    expect(handle.visibleCount()).toBe(0);
    expect(handle.layer.style.display).toBe("none");
    expect(container.querySelector('[data-testid="ice-presence-cursor"]')).toBeNull();
  });

  it("paints a peer's pointer with the Board they are inside", () => {
    const { container, handle } = stage({
      peers: { "peer-1": peer({ pointer: { x: 120, y: 90 }, boardOf: NESTED }) },
    });

    const el = cursor(container);
    expect(el).not.toBeNull();
    expect(handle.layer.style.display).toBe("block");
    expect(el?.style.transform).toBe("translate(120px, 90px)");
    const label = container.querySelector('[data-testid="ice-presence-cursor-label"]');
    expect(label?.textContent).toBe("Ada · Interviews");
    expect(handle.visibleCount()).toBe(1);
  });

  it("keeps the element and moves it, so a cursor glides instead of blinking", () => {
    const stageOne = stage({ peers: { "peer-1": peer({ pointer: { x: 10, y: 10 } }) } });
    const first = cursor(stageOne.container);
    stageOne.setPeers({ "peer-1": peer({ pointer: { x: 40, y: 30 } }) });
    const second = cursor(stageOne.container);
    expect(second).toBe(first);
    expect(second?.style.transform).toBe("translate(40px, 30px)");
  });

  it("rings every instance a peer has selected, and reaps the ring when they let go", () => {
    const { container, setPeers } = stage({
      peers: { "peer-1": peer({ selection: { nodeIds: ["card-a"] } }) },
    });
    expect(container.querySelectorAll('[data-testid="ice-presence-ring"]')).toHaveLength(1);
    const ring = container.querySelector<HTMLElement>('[data-testid="ice-presence-ring"]');
    expect(ring?.style.left).toBe("100px");
    expect(ring?.style.border).toContain("rgb(244, 63, 94)");

    setPeers({ "peer-1": peer({ selection: { nodeIds: [] } }) });
    expect(container.querySelectorAll('[data-testid="ice-presence-ring"]')).toHaveLength(0);
  });

  it("draws a ghost where each dragged instance lands, named", () => {
    const { container } = stage({
      peers: {
        "peer-1": peer({
          dragging: { nodeId: "card-a", boardId: BOARD, position: { x: 140, y: 100 } },
        }),
      },
    });

    const ghost = container.querySelector<HTMLElement>('[data-testid="ice-presence-ghost"]');
    expect(ghost).not.toBeNull();
    expect(ghost?.style.left).toBe("140px");
    expect(ghost?.textContent).toBe("Ada");
  });

  it("paints the marquee a peer is drawing", () => {
    const { container } = stage({
      peers: {
        "peer-1": peer({ selectionBox: { x: 10, y: 20, width: 100, height: 40 } }),
      },
    });
    const marquee = container.querySelector<HTMLElement>('[data-testid="ice-presence-marquee"]');
    expect(marquee?.style.width).toBe("100px");
    expect(marquee?.style.height).toBe("40px");
  });

  it("draws a peer's link preview from the connector anchor", () => {
    const { container } = stage({
      peers: {
        "peer-1": peer({
          connect: {
            nodeId: "card-a",
            connectorId: "c-east",
            anchorEnd: "source",
            position: { x: 400, y: 300 },
          },
        }),
      },
      anchorOf: (cardId, connectorId) =>
        cardId === "card-a" && connectorId === "c-east" ? { x: 340, y: 160 } : null,
    });

    const line = container.querySelector('[data-testid="ice-presence-link"]');
    expect(line?.getAttribute("x1")).toBe("340");
    expect(line?.getAttribute("x2")).toBe("400");
    expect(
      container.querySelector<SVGSVGElement>('[data-testid="ice-presence-links"]')?.style.display,
    ).toBe("block");
  });

  it("marks an editor only where the card has no room for a chip", () => {
    // 240 · 1 is a full card: its own face already names the editor.
    const full = stage({ peers: { "peer-1": peer({ focus: { nodeId: "card-a" } }) } });
    expect(full.container.querySelector('[data-testid="ice-presence-editing"]')).toBeNull();

    // 240 · 0.1 is below the compact width: the dot stands in.
    const icon = stage({ peers: { "peer-1": peer({ focus: { nodeId: "card-a" } }) }, zoom: 0.1 });
    const badge = icon.container.querySelector<HTMLElement>('[data-testid="ice-presence-editing"]');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("data-peer-count")).toBe("1");
  });

  it("hides again when the last peer leaves, and removes its layer on dispose", () => {
    const { container, handle, setPeers } = stage({
      peers: { "peer-1": peer({ pointer: { x: 10, y: 10 } }) },
    });
    setPeers({});
    expect(handle.layer.style.display).toBe("none");

    handle.dispose();
    expect(container.querySelector('[data-testid="ice-presence-layer"]')).toBeNull();
    expect(handle.visibleCount()).toBe(0);
  });
});
