import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
