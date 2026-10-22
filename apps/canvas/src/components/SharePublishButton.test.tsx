import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureSession, getSession } from "../session/session";
import { SharePublishConflictError } from "../session/shares";
import { useUiStore } from "../store/useUiStore";
import { type PublishClient, SharePublishButton } from "./SharePublishButton";

function fakeClient(overrides: Partial<PublishClient> = {}): PublishClient {
  return {
    publishShare: vi.fn(async () => ({ applied: 1 })),
    shareStatus: vi.fn(async () => ({ dirty: false, hasBaseline: true })),
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
    expect(client.publishShare).toHaveBeenCalledWith("tok-1", expect.any(Object), undefined);
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

  it("shows a named all-or-nothing rejection for blocked creations", async () => {
    const client = fakeClient({
      publishShare: vi.fn(async () => {
        throw new SharePublishConflictError({
          conflicts: [],
          unsupported: [
            {
              key: "card:new:create",
              kind: "unsupported",
              label: 'Card "Launch plan"',
              message: "references a card that was moved to Trash.",
            },
          ],
          reason: null,
        });
      }),
    });

    render(<SharePublishButton client={client} />);
    fireEvent.click(screen.getByTestId("share-publish"));

    const dialog = await screen.findByTestId("publish-conflict");
    expect(dialog).toHaveTextContent("Can't publish yet");
    expect(dialog).toHaveTextContent('Card "Launch plan"');
    expect(dialog).toHaveTextContent("moved to Trash");
    expect(dialog).toHaveTextContent("Keep editing");
    expect(screen.queryByTestId("publish-selected")).not.toBeInTheDocument();
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

  it("shows Draft while the draft holds unpublished changes", async () => {
    const client = fakeClient({
      shareStatus: vi.fn(async () => ({ dirty: true, hasBaseline: true })),
    });

    render(<SharePublishButton client={client} />);

    expect(await screen.findByTestId("publish-status")).toHaveTextContent("Draft");
  });

  it("shows Published when the draft matches the workspace", async () => {
    render(<SharePublishButton client={fakeClient()} />);

    expect(await screen.findByTestId("publish-status")).toHaveTextContent("Published");
  });

  it("publishes the checked conflicts and keeps the workspace for the rest", async () => {
    const publishShare = vi
      .fn()
      .mockRejectedValueOnce(
        new SharePublishConflictError({
          conflicts: [
            { key: "card:c1:body", kind: "body", message: "Body changed." },
            { key: "card:c1:field:owner", kind: "property", message: "Field changed." },
          ],
          unsupported: [],
          reason: null,
        }),
      )
      .mockResolvedValueOnce({ applied: 1 });
    const client = fakeClient({ publishShare });

    render(<SharePublishButton client={client} />);
    fireEvent.click(screen.getByTestId("share-publish"));
    await screen.findByTestId("publish-conflict");

    const boxes = screen.getAllByTestId("publish-keep");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[1]).not.toBeChecked();

    fireEvent.click(boxes[1] as HTMLElement);
    expect(boxes[1]).toBeChecked();
    fireEvent.click(screen.getByTestId("publish-selected"));

    await waitFor(() => expect(screen.queryByTestId("publish-conflict")).not.toBeInTheDocument());
    expect(publishShare).toHaveBeenLastCalledWith("tok-1", expect.any(Object), [
      "card:c1:field:owner",
    ]);
  });

  it("keeps the workspace version when no conflict is checked", async () => {
    const publishShare = vi
      .fn()
      .mockRejectedValueOnce(
        new SharePublishConflictError({
          conflicts: [{ key: "card:c1:body", kind: "body", message: "Body changed." }],
          unsupported: [],
          reason: null,
        }),
      )
      .mockResolvedValueOnce({ applied: 0 });
    const client = fakeClient({ publishShare });

    render(<SharePublishButton client={client} />);
    fireEvent.click(screen.getByTestId("share-publish"));
    await screen.findByTestId("publish-conflict");

    fireEvent.click(screen.getByTestId("publish-selected"));

    await waitFor(() => expect(screen.queryByTestId("publish-conflict")).not.toBeInTheDocument());
    expect(publishShare).toHaveBeenLastCalledWith("tok-1", expect.any(Object), []);
  });

  it("keeps publishing blocked while a change cannot be published", async () => {
    const publishShare = vi.fn(async () => {
      throw new SharePublishConflictError({
        conflicts: [{ key: "card:c1:body", kind: "body", message: "Body changed." }],
        unsupported: [{ key: "card:c2", kind: "unsupported", message: "No new cards." }],
        reason: null,
      });
    });
    const client = fakeClient({ publishShare });

    render(<SharePublishButton client={client} />);
    fireEvent.click(screen.getByTestId("share-publish"));
    await screen.findByTestId("publish-conflict");

    expect(screen.getByTestId("publish-conflict-unsupported")).toHaveTextContent("No new cards.");
    expect(screen.getByTestId("publish-selected")).toBeDisabled();

    fireEvent.click(screen.getByTestId("publish-selected"));
    expect(publishShare).toHaveBeenCalledTimes(1);
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
