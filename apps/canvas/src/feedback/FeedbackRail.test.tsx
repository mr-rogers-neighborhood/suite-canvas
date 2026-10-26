import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDurabilityStore } from "../storage/durability";
import { useCanvasStore } from "../store/useCanvasStore";
import { resetAnnouncerForTests } from "./announcer";
import { FeedbackRail } from "./FeedbackRail";
import { useToastStore } from "./toast";

beforeEach(() => {
  resetAnnouncerForTests();
  useToastStore.getState().clear();
  useCanvasStore.setState({ status: "connected", ready: true });
  useDurabilityStore.setState({ persist: "unknown", quota: null });
});

describe("FeedbackRail", () => {
  it("should say nothing about the relay or storage while both are fine", () => {
    render(<FeedbackRail workspaceId="ws-1" signedIn synced />);

    expect(screen.queryByTestId("connection-banner")).toBeNull();
    expect(screen.queryByTestId("storage-shell-warning")).toBeNull();
    expect(screen.getByTestId("save-indicator")).toBeInTheDocument();
  });

  /**
   * The relay and this device are different claims. A tab can be offline while
   * its storage is fine, online while its copy is at risk, or both at once; one
   * surface must never take the other's place.
   */
  it("should show the relay and the storage warning at the same time", () => {
    useDurabilityStore.setState({ persist: "denied" });
    render(<FeedbackRail workspaceId="ws-1" signedIn={false} synced={false} />);

    act(() => {
      useCanvasStore.setState({ status: "disconnected" });
    });

    expect(screen.getByTestId("connection-banner")).toHaveAttribute("data-kind", "offline");
    expect(screen.getByTestId("storage-shell-warning")).toBeInTheDocument();
  });

  /** Another device in the room holds a copy, so this one can be cleared safely. */
  it("should keep the storage warning quiet when the relay already holds a copy", () => {
    useDurabilityStore.setState({ persist: "denied" });
    render(<FeedbackRail workspaceId="ws-1" signedIn={false} synced />);

    expect(screen.queryByTestId("storage-shell-warning")).toBeNull();
  });

  it("should keep the storage warning quiet for a signed-in device", () => {
    useDurabilityStore.setState({ persist: "denied" });
    render(<FeedbackRail workspaceId="ws-1" signedIn synced={false} />);

    expect(screen.queryByTestId("storage-shell-warning")).toBeNull();
  });
});
