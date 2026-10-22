import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureSession, getSession } from "../session/session";
import { SharePublishConflictError } from "../session/shares";
import { useUiStore } from "../store/useUiStore";
import { type PublishClient, SharePublishButton } from "./SharePublishButton";

function fakeClient(overrides: Partial<PublishClient> = {}): PublishClient {
  return {
    publishShare: vi.fn(async () => ({ applied: 1 })),
    reloadShare: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  configureSession({
    workspaceId: "share-tok",
    roomId: "share-tok",
    share: {
      token: "tok-1",
      scope: "board",
      role: "editor",
      workspaceId: "share-tok",
      boardId: "board-1",
      cardId: null,
      roomId: "share-tok",
    },
    role: "editor",
    readOnly: false,
    ownerKey: null,
  });
  useUiStore.setState({ canPublish: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  configureSession({ ...getSession(), share: null, ownerKey: null });
  useUiStore.setState({ canPublish: true });
});

describe("SharePublishButton", () => {
  it("renders nothing when the session cannot publish", () => {
    useUiStore.setState({ canPublish: false });
    render(<SharePublishButton client={fakeClient()} />);
    expect(screen.queryByTestId("share-publish")).not.toBeInTheDocument();
  });

  it("publishes and briefly reports the result", async () => {
    const client = fakeClient();
    render(<SharePublishButton client={client} />);

    fireEvent.click(screen.getByTestId("share-publish"));

    expect(screen.getByTestId("share-publish")).toHaveTextContent("Publishing…");
    expect(await screen.findByTestId("publish-status")).toHaveTextContent("Published");
    expect(client.publishShare).toHaveBeenCalledWith("tok-1", expect.any(Object));
  });

  it("lists conflicts and reloads from the workspace after confirmation", async () => {
    const client = fakeClient({
      publishShare: vi.fn(async () => {
        throw new SharePublishConflictError({
          conflicts: [{ key: "card:c1:body", kind: "body", message: "Body changed." }],
          unsupported: [{ key: "card:c2", kind: "unsupported", message: "No new cards." }],
          reason: null,
        });
      }),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SharePublishButton client={client} />);
    fireEvent.click(screen.getByTestId("share-publish"));

    const dialog = await screen.findByTestId("publish-conflict");
    expect(dialog).toHaveTextContent("card:c1:body");
    expect(dialog).toHaveTextContent("Body changed.");
    expect(dialog).toHaveTextContent("No new cards.");

    fireEvent.click(screen.getByTestId("publish-reload"));

    await waitFor(() => expect(client.reloadShare).toHaveBeenCalledWith("tok-1"));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("publish-conflict")).not.toBeInTheDocument());
  });

  it("keeps the draft when reload is cancelled and closes on Close", async () => {
    const client = fakeClient({
      publishShare: vi.fn(async () => {
        throw new SharePublishConflictError({
          conflicts: [{ key: "card:c1:body", kind: "body", message: "Body changed." }],
          unsupported: [],
          reason: null,
        });
      }),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<SharePublishButton client={client} />);
    fireEvent.click(screen.getByTestId("share-publish"));
    await screen.findByTestId("publish-conflict");

    fireEvent.click(screen.getByTestId("publish-reload"));
    expect(client.reloadShare).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByTestId("publish-conflict")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("publish-close"));
    expect(screen.queryByTestId("publish-conflict")).not.toBeInTheDocument();
  });

  it("shows a readable publish error", async () => {
    const client = fakeClient({
      publishShare: vi.fn(async () => {
        throw new Error("This link is read-only.");
      }),
    });

    render(<SharePublishButton client={client} />);
    fireEvent.click(screen.getByTestId("share-publish"));

    expect(await screen.findByTestId("publish-error")).toHaveTextContent("This link is read-only.");
  });
});
