import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureSession, getSession } from "../session/session";
import type { CreateShareInput, Share } from "../session/shares";
import { lastUsedLabel, type ShareClient, ShareDialog } from "./ShareDialog";

const OWNER_KEY = "owner-key-1";

function shareAt(overrides: Partial<Share> = {}): Share {
  return {
    id: "share-1",
    scope: "workspace",
    role: "viewer",
    workspaceId: "ws-1",
    boardId: null,
    cardId: null,
    createdAt: Date.UTC(2026, 0, 15),
    revokedAt: null,
    expiresAt: null,
    lastUsedAt: null,
    roomId: "ws-1",
    cardIds: [],
    cardCount: 0,
    ...overrides,
  };
}

function fakeClient(shares: Share[] = []) {
  return {
    createShare: vi.fn(async (_input: CreateShareInput, _ownerKey: string | null) => ({
      token: "tok-9",
      share: shareAt({ id: "share-9" }),
    })),
    listShares: vi.fn(async () => shares),
    revokeShare: vi.fn(async (id: string) => shareAt({ id, revokedAt: Date.now() })),
    revokeAllShares: vi.fn(async () => [shareAt({ revokedAt: Date.now() })]),
    defaults: vi.fn(async () => ({ hosted: false, defaultExpiryDays: 0 })),
  };
}

function renderDialog(
  client: ShareClient,
  overrides: Partial<Parameters<typeof ShareDialog>[0]> = {},
) {
  return render(
    <ShareDialog
      workspaceId="ws-1"
      boardId="board-1"
      boardName="Research"
      cardId="card-1"
      cardTitle="Roadmap"
      onClose={() => {}}
      client={client}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  // The dialog reads the owner key from the booted session.
  configureSession({
    workspaceId: "ws-1",
    roomId: "ws-1",
    share: null,
    role: "editor",
    readOnly: false,
    ownerKey: OWNER_KEY,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  configureSession({ ...getSession(), ownerKey: null });
});

describe("ShareDialog", () => {
  it("opens on the workspace editor link and lists active links", async () => {
    const client = fakeClient([shareAt({ id: "share-1" })]);
    renderDialog(client);

    expect(screen.getByTestId("share-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("share-tab-workspace")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("share-role-editor")).toHaveAttribute("aria-pressed", "true");

    expect(await screen.findByTestId("share-row-share-1")).toBeInTheDocument();
    expect(client.listShares).toHaveBeenCalledWith("ws-1", OWNER_KEY);
  });

  it("disables the card tab when no card is selected", async () => {
    const client = fakeClient();
    renderDialog(client, { cardId: null, cardTitle: null });

    expect(screen.getByTestId("share-tab-card")).toBeDisabled();
    expect(screen.getByTestId("share-tab-board")).toBeEnabled();
    await screen.findByTestId("share-empty");
  });

  it("mints a workspace editor token instead of copying the owner link", async () => {
    const client = fakeClient();
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-role-editor"));
    fireEvent.click(screen.getByTestId("share-create"));

    expect(client.createShare).toHaveBeenCalledWith(
      {
        workspaceId: "ws-1",
        scope: "workspace",
        role: "editor",
        boardId: null,
        cardId: null,
        expiresAt: null,
      },
      OWNER_KEY,
    );
    const input = await screen.findByLabelText("Share link");
    const url = new URL((input as HTMLInputElement).value);
    expect(url.searchParams.get("share")).toBe("tok-9");
    expect(url.hash).toBe("");
  });

  it("creates a token link for a board viewer", async () => {
    const client = fakeClient();
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-tab-board"));
    fireEvent.click(screen.getByTestId("share-create"));

    const input = await screen.findByLabelText("Share link");
    expect(new URL((input as HTMLInputElement).value).searchParams.get("share")).toBe("tok-9");
    expect(client.createShare).toHaveBeenCalledWith(
      {
        workspaceId: "ws-1",
        scope: "board",
        role: "viewer",
        boardId: "board-1",
        cardId: null,
        expiresAt: null,
      },
      OWNER_KEY,
    );

    // The dialog reloads the list so the new link shows up without reopening.
    await waitFor(() => expect(client.listShares).toHaveBeenCalledTimes(2));
  });

  it("creates a token link for the selected card", async () => {
    const client = fakeClient();
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-tab-card"));
    fireEvent.click(screen.getByTestId("share-create"));

    await screen.findByLabelText("Share link");
    expect(client.createShare).toHaveBeenCalledWith(
      {
        workspaceId: "ws-1",
        scope: "card",
        role: "viewer",
        boardId: null,
        cardId: "card-1",
        expiresAt: null,
      },
      OWNER_KEY,
    );
  });

  it("creates a workspace viewer link", async () => {
    const client = fakeClient();
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-role-viewer"));

    expect(screen.getByTestId("share-hint")).toHaveTextContent("Viewers can read every board");
    expect(screen.queryByTestId("share-coming-next")).not.toBeInTheDocument();
    expect(screen.getByTestId("share-create")).toBeEnabled();

    fireEvent.click(screen.getByTestId("share-create"));

    const input = await screen.findByLabelText("Share link");
    expect(new URL((input as HTMLInputElement).value).searchParams.get("share")).toBe("tok-9");
    expect(client.createShare).toHaveBeenCalledWith(
      {
        workspaceId: "ws-1",
        scope: "workspace",
        role: "viewer",
        boardId: null,
        cardId: null,
        expiresAt: null,
      },
      OWNER_KEY,
    );
  });

  it("creates a board editor token with the publishing hint", async () => {
    const client = fakeClient();
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-tab-board"));
    fireEvent.click(screen.getByTestId("share-role-editor"));

    expect(screen.getByTestId("share-hint")).toHaveTextContent(
      "Editors can change this board and publish. No new cards or type changes.",
    );
    expect(screen.queryByTestId("share-coming-next")).not.toBeInTheDocument();
    expect(screen.getByTestId("share-create")).toHaveTextContent("Create editor link");
    expect(screen.getByTestId("share-create")).toBeEnabled();

    fireEvent.click(screen.getByTestId("share-create"));

    const input = await screen.findByLabelText("Share link");
    expect(new URL((input as HTMLInputElement).value).searchParams.get("share")).toBe("tok-9");
    expect(client.createShare).toHaveBeenCalledWith(
      {
        workspaceId: "ws-1",
        scope: "board",
        role: "editor",
        boardId: "board-1",
        cardId: null,
        expiresAt: null,
      },
      OWNER_KEY,
    );
  });

  it("creates a card editor token", async () => {
    const client = fakeClient();
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-tab-card"));
    fireEvent.click(screen.getByTestId("share-role-editor"));

    expect(screen.getByTestId("share-hint")).toHaveTextContent(
      "Editors can change this card and publish. No new cards or type changes.",
    );
    fireEvent.click(screen.getByTestId("share-create"));

    await screen.findByLabelText("Share link");
    expect(client.createShare).toHaveBeenCalledWith(
      {
        workspaceId: "ws-1",
        scope: "card",
        role: "editor",
        boardId: null,
        cardId: "card-1",
        expiresAt: null,
      },
      OWNER_KEY,
    );
  });

  it("revokes a link and refreshes the list", async () => {
    const client = fakeClient([shareAt({ id: "share-1" })]);
    renderDialog(client);

    fireEvent.click(await screen.findByTestId("share-revoke-share-1"));

    await waitFor(() => expect(client.revokeShare).toHaveBeenCalledWith("share-1", OWNER_KEY));
    await waitFor(() => expect(client.listShares).toHaveBeenCalledTimes(2));
  });

  it("copies a link and reports the copy", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const client = fakeClient();
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-create"));
    await screen.findByLabelText("Share link");
    fireEvent.click(screen.getByTestId("share-copy"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("shows the API error when a link cannot be created", async () => {
    const client = fakeClient();
    client.createShare.mockRejectedValueOnce(new Error("This workspace is protected."));
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-tab-board"));
    fireEvent.click(screen.getByTestId("share-create"));

    expect(await screen.findByTestId("share-error")).toHaveTextContent(
      "This workspace is protected.",
    );
    expect(screen.queryByTestId("share-link")).not.toBeInTheDocument();
  });
});

describe("ShareDialog selection scope", () => {
  it("disables the selection tab below two cards", async () => {
    const client = fakeClient();
    const { unmount } = renderDialog(client);

    expect(screen.getByTestId("share-tab-selection")).toBeDisabled();
    expect(screen.getByTestId("share-tab-selection")).toHaveAttribute(
      "title",
      "Select two or more cards to share a subset.",
    );
    await screen.findByTestId("share-empty");
    unmount();

    renderDialog(fakeClient(), { selectedCardIds: ["card-1"] });
    expect(screen.getByTestId("share-tab-selection")).toBeDisabled();
    await screen.findByTestId("share-empty");
  });

  it("enables the selection tab with two cards and preselects the viewer", async () => {
    renderDialog(fakeClient(), { selectedCardIds: ["card-1", "card-2"] });

    expect(screen.getByTestId("share-tab-selection")).toBeEnabled();
    fireEvent.click(screen.getByTestId("share-tab-selection"));

    expect(screen.getByTestId("share-tab-selection")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("share-role-viewer")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("share-role-editor")).toBeDisabled();
    expect(screen.getByTestId("share-role-editor")).toHaveAttribute(
      "title",
      "Editor \u2014 next phase",
    );
    expect(screen.getByTestId("share-hint")).toHaveTextContent(
      "Viewers see these 2 cards and the sections around them. Everything else stays private.",
    );
    await screen.findByTestId("share-empty");
  });

  it("creates a selection link with the board and the exact card ids", async () => {
    const client = fakeClient();
    renderDialog(client, { selectedCardIds: ["card-1", "card-2", "card-3"] });

    fireEvent.click(screen.getByTestId("share-tab-selection"));
    fireEvent.click(screen.getByTestId("share-create"));

    await screen.findByLabelText("Share link");
    expect(client.createShare).toHaveBeenCalledWith(
      {
        workspaceId: "ws-1",
        scope: "selection",
        role: "viewer",
        boardId: "board-1",
        cardId: null,
        cardIds: ["card-1", "card-2", "card-3"],
        expiresAt: null,
      },
      OWNER_KEY,
    );
  });

  it("opens on the requested scope and falls back when it loses its target", async () => {
    const { unmount } = renderDialog(fakeClient(), {
      initialScope: "selection",
      selectedCardIds: ["card-1", "card-2"],
    });

    expect(screen.getByTestId("share-tab-selection")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("share-role-viewer")).toHaveAttribute("aria-pressed", "true");
    await screen.findByTestId("share-empty");
    unmount();

    renderDialog(fakeClient(), { initialScope: "selection", selectedCardIds: ["card-1"] });
    expect(screen.getByTestId("share-tab-workspace")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("share-role-editor")).toHaveAttribute("aria-pressed", "true");
    await screen.findByTestId("share-empty");
  });

  it("labels an active selection link by its card count", async () => {
    const client = fakeClient([
      shareAt({
        id: "share-selection",
        scope: "selection",
        role: "viewer",
        boardId: "board-1",
        cardIds: ["card-1", "card-2"],
        cardCount: 2,
      }),
    ]);
    renderDialog(client);

    const row = await screen.findByTestId("share-row-share-selection");
    expect(row).toHaveTextContent("Selection \u00b7 2 cards");
  });
});

describe("ShareDialog limits", () => {
  it("passes a selected expiry to the server", async () => {
    const client = fakeClient();
    renderDialog(client);

    fireEvent.change(screen.getByTestId("share-expiry"), { target: { value: "7" } });
    fireEvent.click(screen.getByTestId("share-create"));
    await screen.findByLabelText("Share link");

    const input = client.createShare.mock.calls[0]?.[0] as { expiresAt?: number | null };
    expect(input.expiresAt).toBeGreaterThan(Date.now());
    expect(input.expiresAt).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1000);
  });

  it("revokes every link after confirmation", async () => {
    const client = fakeClient([shareAt({ id: "share-1" })]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDialog(client);

    fireEvent.click(await screen.findByTestId("share-revoke-all"));
    await waitFor(() => expect(client.revokeAllShares).toHaveBeenCalledWith("ws-1", OWNER_KEY));
  });
});

describe("ShareDialog last used", () => {
  const now = Date.UTC(2026, 2, 1, 12, 0, 0);

  it("labels a link nobody opened as never used", () => {
    expect(lastUsedLabel(null, now)).toBe("Never used");
  });

  it("labels a use inside the minute as just now", () => {
    expect(lastUsedLabel(now - 20_000, now)).toBe("Last used just now");
    // A clock that went backwards must not read as a future use.
    expect(lastUsedLabel(now + 5_000, now)).toBe("Last used just now");
  });

  it("labels an older use in relative time", () => {
    expect(lastUsedLabel(now - 2 * 60 * 60 * 1000, now)).toMatch(/^Last used .*2.*ago$/);
    expect(lastUsedLabel(now - 3 * 24 * 60 * 60 * 1000, now)).toMatch(/^Last used .*3.*ago$/);
  });

  it("renders never, just-now and older in the active-link rows", async () => {
    const stamp = Date.now();
    const client = fakeClient([
      shareAt({ id: "share-never", lastUsedAt: null }),
      shareAt({ id: "share-fresh", lastUsedAt: stamp - 5_000 }),
      shareAt({ id: "share-old", lastUsedAt: stamp - 2 * 60 * 60 * 1000 }),
    ]);
    renderDialog(client);

    expect(await screen.findByTestId("share-last-used-share-never")).toHaveTextContent(
      "Never used",
    );
    expect(screen.getByTestId("share-last-used-share-fresh")).toHaveTextContent(
      "Last used just now",
    );
    expect(screen.getByTestId("share-last-used-share-old").textContent).toMatch(
      /^Last used .*2.*ago$/,
    );
  });
});

describe("ShareDialog hosted expiry default", () => {
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  it("preselects the hosted 30-day default and sends it", async () => {
    const client = fakeClient();
    client.defaults.mockResolvedValue({ hosted: true, defaultExpiryDays: 30 });
    renderDialog(client);

    await waitFor(() => expect(screen.getByTestId("share-expiry")).toHaveValue("30"));
    fireEvent.click(screen.getByTestId("share-create"));
    await screen.findByLabelText("Share link");

    const input = client.createShare.mock.calls[0]?.[0] as { expiresAt?: number | null };
    expect(input.expiresAt).toBeGreaterThan(Date.now() + THIRTY_DAYS - 60_000);
    expect(input.expiresAt).toBeLessThanOrEqual(Date.now() + THIRTY_DAYS + 60_000);
  });

  it("keeps Never when the relay is self-hosted", async () => {
    const client = fakeClient();
    renderDialog(client);

    await waitFor(() => expect(client.defaults).toHaveBeenCalled());
    expect(screen.getByTestId("share-expiry")).toHaveValue("0");

    fireEvent.click(screen.getByTestId("share-create"));
    await screen.findByLabelText("Share link");
    const input = client.createShare.mock.calls[0]?.[0] as { expiresAt?: number | null };
    expect(input.expiresAt).toBeNull();
  });

  it("keeps an expiry the owner picked before the defaults arrived", async () => {
    const client = fakeClient();
    let resolveDefaults: (value: { hosted: boolean; defaultExpiryDays: number }) => void = () => {};
    client.defaults.mockReturnValue(
      new Promise((resolve) => {
        resolveDefaults = resolve;
      }),
    );
    renderDialog(client);

    fireEvent.change(screen.getByTestId("share-expiry"), { target: { value: "7" } });
    resolveDefaults({ hosted: true, defaultExpiryDays: 30 });

    await waitFor(() => expect(client.defaults).toHaveBeenCalled());
    expect(screen.getByTestId("share-expiry")).toHaveValue("7");
  });
});
