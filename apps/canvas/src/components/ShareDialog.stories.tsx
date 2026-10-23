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
    expiresAt: null,
    roomId: "ws-demo",
    cardIds: [],
    cardCount: 0,
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
    expiresAt: null,
    roomId: "ws-demo",
    cardIds: [],
    cardCount: 0,
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
    expiresAt: null,
    roomId: null,
    cardIds: [],
    cardCount: 0,
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
        expiresAt: null,
        roomId: "share-demo-token",
        cardIds: input.cardIds ? [...input.cardIds] : [],
        cardCount:
          input.scope === "selection"
            ? (input.cardIds?.length ?? 0)
            : input.scope === "card"
              ? 1
              : 0,
      },
    }),
    listShares: async (_workspaceId, _ownerKey) => shares,
    revokeAllShares: async () => shares.map((entry) => ({ ...entry, revokedAt: created })),
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
        expiresAt: null,
        roomId: "ws-demo",
        cardIds: [],
        cardCount: 0,
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

export const Selection: Story = {
  args: {
    initialScope: "selection",
    selectedCardIds: ["card-1", "card-2", "card-3"],
  },
};

export const SelectionNeedsTwoCards: Story = {
  args: {
    selectedCardIds: ["card-1"],
  },
};
