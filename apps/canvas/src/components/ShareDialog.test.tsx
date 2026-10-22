import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Share } from "../session/shares";
import { type ShareClient, ShareDialog } from "./ShareDialog";

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
    roomId: "ws-1",
    ...overrides,
  };
}

function fakeClient(shares: Share[] = []) {
  return {
    createShare: vi.fn(async () => ({ token: "tok-9", share: shareAt({ id: "share-9" }) })),
    listShares: vi.fn(async () => shares),
    revokeShare: vi.fn(async (id: string) => shareAt({ id, revokedAt: Date.now() })),
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ShareDialog", () => {
  it("opens on the workspace editor link and lists active links", async () => {
    const client = fakeClient([shareAt({ id: "share-1" })]);
    renderDialog(client);

    expect(screen.getByTestId("share-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("share-tab-workspace")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("share-role-editor")).toHaveAttribute("aria-pressed", "true");

    expect(await screen.findByTestId("share-row-share-1")).toBeInTheDocument();
    expect(client.listShares).toHaveBeenCalledWith("ws-1");
  });

  it("disables the card tab when no card is selected", async () => {
    const client = fakeClient();
    renderDialog(client, { cardId: null, cardTitle: null });

    expect(screen.getByTestId("share-tab-card")).toBeDisabled();
    expect(screen.getByTestId("share-tab-board")).toBeEnabled();
    await screen.findByTestId("share-empty");
  });

  it("copies the current editor URL for a workspace editor link", async () => {
    const client = fakeClient();
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-role-editor"));
    fireEvent.click(screen.getByTestId("share-create"));

    const input = await screen.findByLabelText("Share link");
    const url = new URL((input as HTMLInputElement).value);
    expect(url.searchParams.get("workspace")).toBe("ws-1");
    expect(url.searchParams.get("board")).toBe("board-1");
    expect(client.createShare).not.toHaveBeenCalled();
  });

  it("creates a token link for a board viewer", async () => {
    const client = fakeClient();
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-tab-board"));
    fireEvent.click(screen.getByTestId("share-create"));

    const input = await screen.findByLabelText("Share link");
    expect(new URL((input as HTMLInputElement).value).searchParams.get("share")).toBe("tok-9");
    expect(client.createShare).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
      cardId: null,
    });

    // The dialog reloads the list so the new link shows up without reopening.
    await waitFor(() => expect(client.listShares).toHaveBeenCalledTimes(2));
  });

  it("creates a token link for the selected card", async () => {
    const client = fakeClient();
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-tab-card"));
    fireEvent.click(screen.getByTestId("share-create"));

    await screen.findByLabelText("Share link");
    expect(client.createShare).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      scope: "card",
      role: "viewer",
      boardId: null,
      cardId: "card-1",
    });
  });

  it("marks a workspace viewer link as coming next", async () => {
    const client = fakeClient();
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-role-viewer"));

    expect(screen.getByTestId("share-create")).toBeDisabled();
    expect(screen.getByTestId("share-coming-next")).toHaveTextContent(
      "Workspace viewer links are coming next",
    );

    fireEvent.click(screen.getByTestId("share-create"));
    expect(client.createShare).not.toHaveBeenCalled();
  });

  it("marks board and card editors as coming next", async () => {
    const client = fakeClient();
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-tab-board"));
    fireEvent.click(screen.getByTestId("share-role-editor"));

    expect(await screen.findByTestId("share-coming-next")).toBeInTheDocument();
    expect(screen.getByTestId("share-create")).toBeDisabled();

    fireEvent.click(screen.getByTestId("share-create"));
    expect(client.createShare).not.toHaveBeenCalled();
  });

  it("revokes a link and refreshes the list", async () => {
    const client = fakeClient([shareAt({ id: "share-1" })]);
    renderDialog(client);

    fireEvent.click(await screen.findByTestId("share-revoke-share-1"));

    await waitFor(() => expect(client.revokeShare).toHaveBeenCalledWith("share-1"));
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
    client.createShare.mockRejectedValueOnce(
      new Error("Board and card editor links are coming next."),
    );
    renderDialog(client);

    fireEvent.click(screen.getByTestId("share-tab-board"));
    fireEvent.click(screen.getByTestId("share-create"));

    expect(await screen.findByTestId("share-error")).toHaveTextContent(
      "Board and card editor links are coming next.",
    );
    expect(screen.queryByTestId("share-link")).not.toBeInTheDocument();
  });
});
