import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SyncInfo, SyncMember } from "../store/useCanvasStore";
import { TitleBar } from "./TitleBar";

const bar = (props: Parameters<typeof TitleBar>[0]) => render(<TitleBar {...props} />);

/** A device in a workspace, as the host would describe it. */
function synced(options: {
  state?: SyncInfo["status"];
  members?: readonly SyncMember[];
}): SyncInfo {
  return {
    workspaceId: "a".repeat(64),
    deviceId: "b".repeat(64),
    status: options.state ?? { state: "syncing", count: 3 },
    members: options.members ?? [
      { deviceId: "b".repeat(64), name: "this laptop", role: "owner" },
      { deviceId: "c".repeat(64), name: "the desktop", role: "editor" },
    ],
  };
}

describe("TitleBar", () => {
  it("says Local only when nobody else has a copy", () => {
    // The default, and the one this product is designed for: a workspace with no hub and no
    // account is not a workspace that failed to connect.
    bar({ sync: null });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Local only");
  });

  it("names the state a person would use, and never the protocol's words", () => {
    const cases = [
      [{ state: "connecting" }, "Connecting"],
      [{ state: "waiting" }, "Waiting"],
      [{ state: "asleep", reason: "the host is not answering" }, "Host asleep"],
      [{ state: "refused", reason: "not-authorized" }, "Not syncing"],
    ] as const;
    for (const [state, label] of cases) {
      cleanup();
      bar({ sync: synced({ state, members: [] }) });
      expect(screen.getByTestId("sync-status")).toHaveTextContent(label);
    }
  });

  it("counts the devices here, including this one", () => {
    bar({ sync: synced({}) });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Syncing· 2");
  });

  it("opens the sync dialog from the pill", () => {
    const onOpenSync = vi.fn();
    bar({ sync: synced({}), onOpenSync });
    fireEvent.click(screen.getByTestId("sync-status"));
    expect(onOpenSync).toHaveBeenCalledOnce();
  });
});

describe("TitleBar command bar", () => {
  it("should open the palette from the search trigger", () => {
    const onOpenSearch = vi.fn();
    bar({ sync: synced({}), onOpenSearch });

    fireEvent.click(screen.getByTestId("command-bar"));

    expect(onOpenSearch).toHaveBeenCalledOnce();
  });

  it("should render no trigger when the shell does not offer one", () => {
    bar({ sync: synced({}) });
    expect(screen.queryByTestId("command-bar")).toBeNull();
  });

  it("should advertise the shortcut it opens", () => {
    bar({ sync: synced({}), onOpenSearch: vi.fn() });
    expect(screen.getByTestId("command-bar")).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+K Control+K",
    );
  });
});

describe("TitleBar home gesture", () => {
  it("should route a plain brand click through the exit animation", () => {
    const onNavigateHome = vi.fn();
    bar({ sync: synced({}), onNavigateHome });

    fireEvent.click(screen.getByRole("link", { name: "Back to workspace launcher" }));
    expect(onNavigateHome).toHaveBeenCalledTimes(1);
  });

  it("should leave modified clicks to the browser", () => {
    const onNavigateHome = vi.fn();
    bar({ sync: synced({}), onNavigateHome });

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
      sync: synced({}),
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
      sync: synced({}),
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
      sync: synced({}),
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
    bar({ sync: synced({}), workspaceName: "Untitled workspace", onNavigateHome });

    fireEvent.click(screen.getByTestId("workspace-name"));
    fireEvent.click(screen.getByTestId("workspace-switcher-home"));
    expect(onNavigateHome).toHaveBeenCalled();
  });
});
