import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordClaimOutcome } from "../session/ownerKey";
import { createOwnerKit } from "../session/ownerKit";
import { WorkspaceProtected } from "./WorkspaceProtected";

const upload = (text: string) => {
  const input = screen.getByTestId("recovery-file");
  const file = new File([text], "research-recovery.suitekey", { type: "application/json" });
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("WorkspaceProtected", () => {
  it("offers a recovery file, a paste disclosure and the launcher", () => {
    render(<WorkspaceProtected workspaceId="ws-1" />);

    expect(screen.getByTestId("recovery-open")).toBeVisible();
    expect(screen.getByTestId("recovery-paste")).not.toBeVisible();
    expect(screen.getByTestId("workspace-protected-launcher")).toBeVisible();
    expect(screen.queryByTestId("recovery-error")).not.toBeInTheDocument();
  });

  it("says another browser owns a workspace this one never opened", () => {
    render(<WorkspaceProtected workspaceId="ws-1" />);

    const detail = screen.getByTestId("workspace-protected-detail");
    expect(detail).toHaveAttribute("data-conflict", "unknown");
    expect(detail).toHaveTextContent("Another browser's owner key already owns this workspace.");
    expect(detail).toHaveTextContent(
      "Open a recovery key file, or the editor link that includes the current owner key.",
    );
    // No local copy exists, so the screen must not promise to keep one.
    expect(detail).not.toHaveTextContent("edits on this device are kept");
  });

  it("keeps the local copy when the workspace was claimed while this device was offline", () => {
    recordClaimOutcome("ws-1", "pending");
    render(<WorkspaceProtected workspaceId="ws-1" />);

    const detail = screen.getByTestId("workspace-protected-detail");
    expect(detail).toHaveAttribute("data-conflict", "pending");
    expect(detail).toHaveTextContent("worked on the workspace offline");
    expect(detail).toHaveTextContent("another browser claimed it first");
    expect(detail).toHaveTextContent("Your edits on this device are kept.");
    // The two exits the screen already had.
    expect(screen.getByTestId("recovery-open")).toBeVisible();
    expect(screen.getByTestId("workspace-protected-launcher")).toBeVisible();
  });

  it("keeps the local copy when this browser's key was replaced", () => {
    recordClaimOutcome("ws-1", "claimed");
    render(<WorkspaceProtected workspaceId="ws-1" />);

    const detail = screen.getByTestId("workspace-protected-detail");
    expect(detail).toHaveAttribute("data-conflict", "claimed");
    expect(detail).toHaveTextContent("The owner key on this device was replaced");
    expect(detail).toHaveTextContent("Your edits on this device are kept.");
  });

  it("refuses a key from a different workspace", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkspaceProtected workspaceId="ws-1" />);

    upload(createOwnerKit("ws-2", "owner-key-2"));

    await waitFor(() =>
      expect(screen.getByTestId("recovery-error")).toHaveTextContent(
        "That recovery key does not own this workspace.",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not install a key that could not be verified while offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    render(<WorkspaceProtected workspaceId="ws-1" />);

    upload(createOwnerKit("ws-1", "recovered-key"));

    await waitFor(() =>
      expect(screen.getByTestId("recovery-error")).toHaveTextContent(
        "The server could not be reached, so this key is not verified yet.",
      ),
    );
    expect(screen.getByTestId("recovery-error")).toHaveTextContent(
      "Your edits on this device are kept",
    );
    // Nothing was written, so the next boot cannot present an unverified key.
    expect(window.localStorage.getItem("suite.owner.ws-1")).toBeNull();
  });

  it("reports a malformed file readably", async () => {
    render(<WorkspaceProtected workspaceId="ws-1" />);

    upload("{not json");

    await waitFor(() =>
      expect(screen.getByTestId("recovery-error")).toHaveTextContent("not a Suite recovery key"),
    );
  });

  it("reports a malformed pasted key instead of navigating", () => {
    render(<WorkspaceProtected workspaceId="ws-1" />);

    fireEvent.click(screen.getByText("Paste recovery key"));
    fireEvent.change(screen.getByTestId("recovery-paste"), {
      target: { value: '{"kind":"suite.workspace"}' },
    });
    fireEvent.click(screen.getByTestId("recovery-paste-apply"));

    expect(screen.getByTestId("recovery-error")).toHaveTextContent("workspace backup");
  });
});
