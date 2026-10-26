import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TitleBar } from "./TitleBar";

// `role` is this component's own prop (who is reading the share), not an ARIA
// role, so the a11y rule is reading the JSX too literally here. Signed in by
// default: a signed-out browser is its own case, below.
const bar = (props: Parameters<typeof TitleBar>[0]) => render(<TitleBar signedIn {...props} />);

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

  it("names the connection in one word each: Synced, Syncing, Offline, No access", () => {
    bar({ status: "connecting", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Syncing");

    cleanup();
    bar({ status: "rejoining", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Syncing");

    cleanup();
    bar({ status: "disconnected", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Offline");

    cleanup();
    bar({ status: "unauthorized", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("No access");
  });

  /**
   * A refused credential and a lost connection are not the same problem. The
   * indicator said "Offline" for both, so a reader whose access was revoked was
   * told to check a connection that was working.
   */
  it("says access is the problem when the relay refused this browser", () => {
    bar({ status: "unauthorized" });

    const status = screen.getByTestId("sync-status");
    expect(status).toHaveAttribute("data-status", "unauthorized");
    expect(status).not.toHaveTextContent("Offline");

    fireEvent.click(status);

    const sentence = screen.getByTestId("sync-room");
    expect(sentence).toHaveTextContent("refused this browser's access");
    expect(sentence).toHaveTextContent("Sign in again");
    expect(sentence).not.toHaveTextContent(/connection/i);
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
    bar({ status: "unauthorized", signedIn: false });

    expect(screen.getByTestId("sync-status")).toHaveTextContent("Local");
    expect(screen.getByTestId("sync-status")).not.toHaveTextContent("No access");

    fireEvent.click(screen.getByTestId("sync-status"));

    const sentence = screen.getByTestId("sync-room");
    expect(sentence).toHaveTextContent("Local only");
    expect(sentence).toHaveTextContent("Sign in to sync");
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

  it("names the room the relay holds", () => {
    bar({ status: "connected", workspaceId: "ws-42" });
    fireEvent.click(screen.getByTestId("sync-status"));
    expect(screen.getByTestId("sync-facts")).toHaveTextContent("ws-42");
  });

  it("counts the people in the room", () => {
    bar({ status: "connected", peerCount: 2 });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("3 here");

    fireEvent.click(screen.getByTestId("sync-status"));

    expect(screen.getByTestId("sync-room")).toHaveTextContent("3 here, including you");
  });

  it("keeps everything about this device under the same control", () => {
    bar({ status: "connected", storage: <p data-testid="device-copy">device</p> });

    // One status, one press: there is no second pill beside this one.
    expect(screen.queryByTestId("device-copy")).toBeNull();

    fireEvent.click(screen.getByTestId("sync-status"));

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
