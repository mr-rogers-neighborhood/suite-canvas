import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent } from "storybook/test";
import type { Share } from "../session/shares";
import { type ShareClient, ShareDialog } from "./ShareDialog";

const created = Date.UTC(2026, 0, 15, 9, 30);
/**
 * "Last used" is a relative label, so a fixed *timestamp* makes it drift with the
 * wall clock — a visual snapshot that says "9 months ago" today says "10 months
 * ago" next month. These fixtures are relative to now instead, which keeps the
 * label (and the snapshot) still. Creation dates stay absolute: they are dates.
 */
const now = Date.now();
const HOUR = 60 * 60 * 1000;

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
    lastUsedAt: now - 2 * HOUR,
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
    lastUsedAt: null,
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
    lastUsedAt: now - 30 * 60 * 1000,
    roomId: null,
    cardIds: [],
    cardCount: 0,
  },
];

function demoClient(shares: Share[]): ShareClient {
  return {
    createShare: async (input, _credential) => ({
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
        lastUsedAt: null,
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
    listShares: async (_workspaceId, _credential) => shares,
    defaults: async () => ({ hosted: false, defaultExpiryDays: 0 }),
    revokeAllShares: async () => shares.map((entry) => ({ ...entry, revokedAt: created })),
    revokeShare: async (id, _credential) => {
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
        lastUsedAt: null,
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

export const Workspace: Story = {
  play: async () => {
    // Nothing is selected, so the subset scope is offered but disabled.
    await expect(screen.getByTestId("share-tab-selection")).toBeDisabled();
    await expect(screen.getByTestId("share-tab-workspace")).toHaveAttribute("aria-pressed", "true");
    await expect(screen.getByTestId("share-hint")).toHaveTextContent(
      "Editors can change every board",
    );
  },
};

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
  play: async () => {
    await expect(screen.getByTestId("share-tab-selection")).toBeEnabled();
    await userEvent.click(screen.getByTestId("share-tab-selection"));
    // A subset link names how many cards the viewer gets, and stays read-only.
    await expect(screen.getByTestId("share-hint")).toHaveTextContent("Viewers see these 3 cards");
    await expect(screen.getByTestId("share-role-editor")).toBeDisabled();
  },
};

export const SelectionNeedsTwoCards: Story = {
  args: {
    selectedCardIds: ["card-1"],
  },
  play: async () => {
    const tab = screen.getByTestId("share-tab-selection");
    await expect(tab).toBeDisabled();
    await expect(tab).toHaveAttribute("title", "Select two or more cards to share a subset.");
  },
};
