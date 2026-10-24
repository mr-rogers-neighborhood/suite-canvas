import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";
import type { PeerPresence } from "../collab/presence";
import type { IcePresenceInstance } from "./icePresence";
import { createIcePresenceLayer } from "./icePresenceLayer";

/**
 * The layer is plain DOM, so the story mounts it the way the surface does: one
 * inert layer in a container, synced once. Everything the story shows — a
 * cursor, a Board suffix, a ring, a drag ghost, a marquee, an in-flight link and
 * the icon-band editing dot — is produced by `projectPeerPresence`, not by the
 * story.
 */
const BOARD = "view-story";

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

const ADa = peer({
  clientId: "peer-ada",
  user: { name: "Ada", color: "#f43f5e" },
  pointer: { x: 300, y: 180 },
  boardOf: "board-interviews",
});

const GRACE = peer({
  clientId: "peer-grace",
  user: { name: "Grace", color: "#22d3ee" },
  selection: { nodeIds: ["card-a"] },
  dragging: { nodeId: "card-a", boardId: BOARD, position: { x: 420, y: 260 } },
});

const LINUS = peer({
  clientId: "peer-linus",
  user: { name: "Linus", color: "#a3e635" },
  selectionBox: { x: 520, y: 120, width: 220, height: 160 },
  connect: {
    nodeId: "card-a",
    connectorId: "c-east",
    anchorEnd: "source",
    position: { x: 760, y: 200 },
  },
});

const INSTANCES: readonly IcePresenceInstance[] = [
  {
    instanceKey: "card:card-a",
    cardId: "card-a",
    boardId: BOARD,
    rect: { x: 260, y: 120, width: 240, height: 160 },
  },
  {
    instanceKey: "card:card-tiny",
    cardId: "card-tiny",
    boardId: BOARD,
    rect: { x: 120, y: 420, width: 40, height: 40 },
  },
];

function PresenceStage({ peers }: { readonly peers: readonly PeerPresence[] }) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = host.current;
    if (container === null) return;
    const byId = Object.fromEntries(peers.map((entry) => [entry.clientId, entry]));
    const layer = createIcePresenceLayer({
      container,
      peers: () => byId,
      boardId: BOARD,
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      instances: () => INSTANCES,
      boardName: (id) => (id === "board-interviews" ? "Interviews" : undefined),
      viewport: () => ({ width: 960, height: 560 }),
      anchorOf: (cardId, connectorId) =>
        cardId === "card-a" && connectorId === "c-east" ? { x: 500, y: 200 } : null,
    });
    layer.sync();
    return () => layer.dispose();
  }, [peers]);

  return (
    <div
      ref={host}
      role="img"
      aria-label="Three peers on an ICE canvas: a cursor inside the Interviews Board, a selection ring and drag ghost, and a marquee with a link preview."
      style={{
        position: "relative",
        width: "100%",
        height: "560px",
        overflow: "hidden",
        background: "var(--canvas-bg, #f2f1ee)",
      }}
    />
  );
}

const meta: Meta<typeof PresenceStage> = {
  title: "ICE/Presence layer",
  component: PresenceStage,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof PresenceStage>;

export const ThreePeers: Story = {
  args: { peers: [ADa, GRACE, LINUS] },
};

export const OnePeerInsideABoard: Story = {
  args: { peers: [ADa] },
};

export const Nobody: Story = {
  args: { peers: [] },
};
