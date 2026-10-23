import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TitleBar } from "./TitleBar";

// `role` is this component's own prop (who is reading the share), not an ARIA
// role, so the a11y rule is reading the JSX too literally here.
const bar = (props: Parameters<typeof TitleBar>[0]) => render(<TitleBar {...props} />);

describe("TitleBar", () => {
  it("names the role once a share is connected", () => {
    bar({ status: "connected", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Viewer");
  });

  it("shows Editor for an editable share", () => {
    bar({ status: "connected", role: "editor" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Editor");
  });

  it("keeps the connection words while syncing, rejoining or offline", () => {
    bar({ status: "connecting", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Syncing");

    cleanup();
    bar({ status: "rejoining", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Reconnecting");

    cleanup();
    bar({ status: "disconnected", role: "viewer" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Offline");
  });

  it("still says Live outside a share", () => {
    bar({ status: "connected" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Live");
  });
});
