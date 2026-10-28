import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TitleBar } from "./TitleBar";

// `role` is this component's own prop (who is reading the share), not an ARIA
// role, so the a11y rule is reading the JSX too literally here. Signed in by
// default: a signed-out browser is its own case, below.
const bar = (props: Parameters<typeof TitleBar>[0]) =>
  render(<TitleBar phase="signed-in" {...props} />);

describe("TitleBar", () => {
  it("says Synced, and puts what the share allows in the panel", () => {
    bar({ status: "connected", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Synced");

    fireEvent.click(screen.getByTestId("sync-status"));

    expect(screen.getByTestId("sync-room")).toHaveTextContent("viewing this workspace");
  });

  it("says editing for an editable share", () => {
    bar({ status: "connected", role: "editor" });
    fireEvent.click(screen.getByTestId("sync-status"));
    expect(screen.getByTestId("sync-room")).toHaveTextContent("editing this workspace");
  });

  it("names the connection in one word each: Synced, Syncing, Offline", () => {
    bar({ status: "connecting", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Syncing");

    cleanup();
    bar({ status: "rejoining", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Syncing");

    cleanup();
    bar({ status: "disconnected", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Offline");
  });

  /**
   * A refusal is not advice to check a connection, and it is not an accusation
   * either. What it says depends on why the relay said no.
   */
  it("sends an ended session to sign in", () => {
    bar({ status: "unauthorized", reason: "session" });

    const status = screen.getByTestId("sync-status");
    expect(status).toHaveAttribute("data-status", "unauthorized");
    expect(status).toHaveTextContent("Sign in");

    fireEvent.click(status);

    expect(screen.getByTestId("sync-room")).toHaveTextContent("session ended");
    expect(screen.getByTestId("sync-sign-in")).toBeInTheDocument();
  });

  it("says the workspace is saved here when the refusal has no name", () => {
    bar({ status: "unauthorized" });

    fireEvent.click(screen.getByTestId("sync-status"));

    const sentence = screen.getByTestId("sync-room");
    expect(sentence).toHaveTextContent("saved here");
    expect(sentence).not.toHaveTextContent(/refused this browser/i);
  });

  it("reads a plan that does not cover this workspace as local, and offers the plan", () => {
    bar({ status: "unauthorized", claim: "capped" });

    expect(screen.getByTestId("sync-status")).toHaveTextContent("Local");
    fireEvent.click(screen.getByTestId("sync-status"));
    expect(screen.getByTestId("sync-room")).toHaveTextContent("plan does not cover");
    expect(screen.getByTestId("sync-see-plans")).toBeInTheDocument();
  });

  it("still says Offline for a lost connection", () => {
    bar({ status: "disconnected" });
    fireEvent.click(screen.getByTestId("sync-status"));

    expect(screen.getByTestId("sync-room")).toHaveTextContent("Offline");
  });

  /**
   * A browser with no session has no credential to refuse, so the relay never
   * said no. Calling that "No access" told every local session its own workspace
   * had rejected it.
   */
  it("reads a signed-out browser as local, not refused", () => {
    bar({ status: "unauthorized", phase: "signed-out" });

    expect(screen.getByTestId("sync-status")).toHaveTextContent("Saved");
    expect(screen.getByTestId("sync-status")).not.toHaveTextContent("Needs attention");

    fireEvent.click(screen.getByTestId("sync-status"));

    const sentence = screen.getByTestId("sync-room");
    expect(sentence).toHaveTextContent("Saved on this device");
    expect(sentence).toHaveTextContent("Sign in to use it on your other devices");
    expect(sentence).not.toHaveTextContent(/refused/i);
    expect(screen.getByTestId("sync-sign-in")).toBeInTheDocument();
  });

  it("offers a retry when the connection dropped", () => {
    bar({ status: "disconnected" });
    fireEvent.click(screen.getByTestId("sync-status"));
    expect(screen.getByTestId("connection-retry")).toBeInTheDocument();
  });

  it("says Synced outside a share too", () => {
    bar({ status: "connected" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Synced");
  });

  it("keeps the room id behind the details", () => {
    bar({ status: "connected", workspaceId: "ws-42" });
    fireEvent.click(screen.getByTestId("sync-status"));

    // A UUID is not something a reader is asked to act on, so it is not on the
    // surface they see first.
    expect(screen.queryByText("ws-42")).toBeNull();

    fireEvent.click(screen.getByTestId("sync-details"));

    expect(screen.getByTestId("sync-details-body")).toHaveTextContent("ws-42");
  });

  it("counts the people in the room", () => {
    bar({ status: "connected", peerCount: 2 });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("3 here");

    fireEvent.click(screen.getByTestId("sync-status"));

    expect(screen.getByTestId("sync-room")).toHaveTextContent("3 here, including you");
  });

  it("keeps everything about this device under the same control, behind Details", () => {
    bar({ status: "connected", storage: <p data-testid="device-copy">device</p> });

    // One status, one press: there is no second pill beside this one.
    expect(screen.queryByTestId("device-copy")).toBeNull();

    fireEvent.click(screen.getByTestId("sync-status"));
    // And the panel answers the question first; the machinery is one press further.
    expect(screen.queryByTestId("device-copy")).toBeNull();

    fireEvent.click(screen.getByTestId("sync-details"));

    expect(screen.getByTestId("device-copy")).toBeInTheDocument();
  });

  it("closes its panel on Escape and on a press outside", () => {
    bar({ status: "connected", storage: <p>device</p> });

    fireEvent.click(screen.getByTestId("sync-status"));
    expect(screen.getByTestId("sync-panel")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("sync-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sync-status"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("sync-panel")).not.toBeInTheDocument();
  });
});

describe("TitleBar command bar", () => {
  it("should open the palette from the search trigger", () => {
    const onOpenSearch = vi.fn();
    bar({ status: "connected", onOpenSearch });

    fireEvent.click(screen.getByTestId("command-bar"));

    expect(onOpenSearch).toHaveBeenCalledOnce();
  });

  it("should render no trigger when the shell does not offer one", () => {
    bar({ status: "connected" });
    expect(screen.queryByTestId("command-bar")).toBeNull();
  });

  it("should advertise the shortcut it opens", () => {
    bar({ status: "connected", onOpenSearch: vi.fn() });
    expect(screen.getByTestId("command-bar")).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+K Control+K",
    );
  });
});

describe("TitleBar home gesture", () => {
  it("should route a plain brand click through the exit animation", () => {
    const onNavigateHome = vi.fn();
    bar({ status: "connected", onNavigateHome });

    fireEvent.click(screen.getByRole("link", { name: "Back to workspace launcher" }));
    expect(onNavigateHome).toHaveBeenCalledTimes(1);
  });

  it("should leave modified clicks to the browser", () => {
    const onNavigateHome = vi.fn();
    bar({ status: "connected", onNavigateHome });

    fireEvent.click(screen.getByRole("link", { name: "Back to workspace launcher" }), {
      ctrlKey: true,
    });
    expect(onNavigateHome).not.toHaveBeenCalled();
  });
});

describe("TitleBar workspace menu", () => {
  const rename = (name: string) => name;

  it("should open from the workspace name rather than renaming on the spot", () => {
    bar({
      status: "connected",
      workspaceName: "Untitled workspace",
      canRenameWorkspace: true,
      onRenameWorkspace: rename,
    });

    fireEvent.click(screen.getByTestId("workspace-name"));
    expect(screen.getByTestId("workspace-switcher")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-name-input")).toBeNull();
  });

  it("should reach rename through the menu", () => {
    bar({
      status: "connected",
      workspaceName: "Untitled workspace",
      canRenameWorkspace: true,
      onRenameWorkspace: rename,
    });

    fireEvent.click(screen.getByTestId("workspace-name"));
    fireEvent.click(screen.getByTestId("workspace-switcher-rename"));
    expect(screen.getByTestId("workspace-name-input")).toHaveValue("Untitled workspace");
  });

  it("should list the other workspaces and open one", () => {
    const onOpenWorkspace = vi.fn();
    bar({
      status: "connected",
      workspaceName: "Untitled workspace",
      otherWorkspaces: [{ id: "ws-2", title: "Reading" }],
      onOpenWorkspace,
    });

    fireEvent.click(screen.getByTestId("workspace-name"));
    fireEvent.click(screen.getByTestId("workspace-switcher-open-ws-2"));
    expect(onOpenWorkspace).toHaveBeenCalledWith("ws-2");
  });

  it("should still offer a way back to the launcher", () => {
    const onNavigateHome = vi.fn();
    bar({ status: "connected", workspaceName: "Untitled workspace", onNavigateHome });

    fireEvent.click(screen.getByTestId("workspace-name"));
    fireEvent.click(screen.getByTestId("workspace-switcher-home"));
    expect(onNavigateHome).toHaveBeenCalled();
  });
});
