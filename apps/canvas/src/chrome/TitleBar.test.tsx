import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TitleBar } from "./TitleBar";

// `role` is this component's own prop (who is reading the share), not an ARIA
// role, so the a11y rule is reading the JSX too literally here.
const bar = (props: Parameters<typeof TitleBar>[0]) => render(<TitleBar {...props} />);

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

  it("keeps the connection words to three: Synced, Syncing, Offline", () => {
    bar({ status: "connecting", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Syncing");

    cleanup();
    bar({ status: "rejoining", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Syncing");

    cleanup();
    bar({ status: "disconnected", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Offline");
  });

  it("says Synced outside a share too", () => {
    bar({ status: "connected" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Synced");
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
