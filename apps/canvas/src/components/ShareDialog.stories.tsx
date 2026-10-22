import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Share } from "../session/shares";
import { type ShareClient, ShareDialog } from "./ShareDialog";

const created = Date.UTC(2026, 0, 15, 9, 30);

const links: Share[] = [
  {
    id: "share-workspace",
    scope: "workspace",
    role: "editor",
    workspaceId: "ws-demo",
    boardId: null,
    cardId: null,
    createdAt: created,
    revokedAt: null,
    roomId: "ws-demo",
  },
  {
    id: "share-workspace-viewer",
    scope: "workspace",
    role: "viewer",
    workspaceId: "ws-demo",
    boardId: null,
    cardId: null,
    createdAt: created - 60_000,
    revokedAt: null,
    roomId: "ws-demo",
  },
  {
    id: "share-board",
    scope: "board",
    role: "viewer",
    workspaceId: "ws-demo",
    boardId: "board-1",
    cardId: null,
    createdAt: created - 90_000,
    revokedAt: null,
    roomId: null,
  },
];

function demoClient(shares: Share[]): ShareClient {
  return {
    createShare: async (input, _ownerKey) => ({
      token: "demo-token",
      share: {
        id: "demo-share",
        scope: input.scope,
        role: input.role,
        workspaceId: input.workspaceId,
        boardId: input.boardId ?? null,
        cardId: input.cardId ?? null,
        createdAt: created,
        revokedAt: null,
        roomId: "share-demo-token",
      },
    }),
    listShares: async (_workspaceId, _ownerKey) => shares,
    revokeShare: async (id, _ownerKey) => {
      const base: Share = shares.find((entry) => entry.id === id) ?? {
        id,
        scope: "workspace",
        role: "editor",
        workspaceId: "ws-demo",
        boardId: null,
        cardId: null,
        createdAt: created,
        revokedAt: null,
        roomId: "ws-demo",
      };
      return { ...base, id, revokedAt: created };
    },
  };
}

const meta = {
  title: "Components/ShareDialog",
  component: ShareDialog,
  parameters: { layout: "fullscreen" },
  args: {
    workspaceId: "ws-demo",
    boardId: "board-1",
    boardName: "Research",
    cardId: "card-1",
    cardTitle: "Roadmap",
    onClose: () => {},
    client: demoClient(links),
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ShareDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Workspace: Story = {};

export const Empty: Story = {
  args: { client: demoClient([]) },
};

export const WithoutCard: Story = {
  args: { cardId: null, cardTitle: null },
};
