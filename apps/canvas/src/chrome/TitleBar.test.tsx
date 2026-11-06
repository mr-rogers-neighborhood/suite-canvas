import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TitleBar } from "./TitleBar";

const bar = (props: Parameters<typeof TitleBar>[0]) => render(<TitleBar {...props} />);

describe("TitleBar", () => {
  it("says Saved whatever the transport is doing", () => {
    // The words used to be Synced, Syncing and Offline, because a socket decided
    // them. There is no socket: the document is on this machine, which is the one
    // thing worth saying, and it says it for every status a stale call can pass.
    for (const status of ["connected", "connecting", "rejoining", "disconnected"] as const) {
      cleanup();
      bar({ status });
      expect(screen.getByTestId("sync-status")).toHaveTextContent("Saved");
    }
  });

  it("counts the people here, including this window", () => {
    bar({ status: "connected", peerCount: 2 });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("3 here");
  });

  it("opens no panel, because there is nothing behind it", () => {
    // The popover explained a relay: a room, a plan, a session that ended. All
    // three belonged to the service, so the indicator is the whole control now.
    bar({ status: "connected" });
    fireEvent.click(screen.getByTestId("sync-status"));
    expect(screen.queryByTestId("sync-room")).toBeNull();
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
