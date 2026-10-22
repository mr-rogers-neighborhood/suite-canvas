import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureSession, getSession } from "../session/session";
import type { CreateShareInput, Share } from "../session/shares";
import { type ShareClient, ShareDialog } from "./ShareDialog";

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
    roomId: "ws-1",
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
