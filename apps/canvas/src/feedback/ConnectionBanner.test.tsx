import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { ConnectionBanner } from "./ConnectionBanner";
import { RECONNECTED_MS } from "./connection";

function setStatus(status: ReturnType<typeof useCanvasStore.getState>["status"]) {
  act(() => {
    useCanvasStore.setState({ status });
  });
}

beforeEach(() => {
  useCanvasStore.setState({ status: "connecting" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConnectionBanner", () => {
  it("should say nothing while the first connection is still opening", () => {
    render(<ConnectionBanner />);
    expect(screen.queryByTestId("connection-banner")).toBeNull();
  });

  it("should say the work stays here, and offer one way to try the relay again", () => {
    const connect = vi.fn();
    useCanvasStore.setState({ connect });
    render(<ConnectionBanner />);
    setStatus("disconnected");

    const banner = screen.getByTestId("connection-banner");
    expect(banner).toHaveTextContent("Offline. Edits stay in this browser.");
    expect(banner).toHaveAttribute("role", "status");

    fireEvent.click(screen.getByTestId("connection-retry"));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("should count the changes made while the relay was away", () => {
    render(<ConnectionBanner />);
    setStatus("disconnected");

    act(() => {
      useCanvasStore.getState().workspace.createCard();
    });

    expect(screen.getByTestId("connection-pending")).toHaveTextContent("1 unsent change");
  });

  it("should not call a refused credential offline", () => {
    render(<ConnectionBanner />);
    setStatus("unauthorized");

    const banner = screen.getByTestId("connection-banner");
    expect(banner).toHaveAttribute("data-kind", "refused");
    expect(banner).not.toHaveTextContent("Offline");
    expect(banner).toHaveTextContent("refused this browser's access");
    expect(screen.queryByTestId("connection-retry")).toBeNull();
  });

  it("should confirm a return briefly, then get out of the way", () => {
    vi.useFakeTimers();
    render(<ConnectionBanner />);

    setStatus("disconnected");
    setStatus("rejoining");
    expect(screen.getByTestId("connection-banner")).toHaveTextContent("Reconnecting…");

    setStatus("connected");
    expect(screen.getByTestId("connection-banner")).toHaveTextContent(
      "Reconnected. Everything is in sync.",
    );

    act(() => {
      vi.advanceTimersByTime(RECONNECTED_MS + 1);
    });
    expect(screen.queryByTestId("connection-banner")).toBeNull();
  });

  it("should not call a first boot a reconnection", () => {
    render(<ConnectionBanner />);

    setStatus("connected");
    expect(screen.queryByTestId("connection-banner")).toBeNull();
  });
});
