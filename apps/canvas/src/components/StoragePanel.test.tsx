import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  formatEstimate,
  isQuotaExceeded,
  requestPersistence,
  useDurabilityStore,
} from "../storage/durability";
import { StoragePanel } from "./StoragePanel";

describe("storage panel", () => {
  beforeEach(() => {
    useDurabilityStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns and offers an export when the browser refuses durable storage", async () => {
    // The gate: `persist()` resolving false is a denial, not a crash.
    await requestPersistence({ persist: async () => false, persisted: async () => false });

    render(<StoragePanel workspaceId="ws-1" />);
    expect(screen.getByTestId("storage-status")).toHaveAttribute("data-persist", "denied");

    fireEvent.click(screen.getByTestId("storage-status"));
    expect(screen.getByTestId("storage-persist")).toHaveTextContent("may evict the local copy");
    expect(screen.getByTestId("storage-warning")).toBeInTheDocument();
    expect(screen.getByTestId("storage-export")).toBeInTheDocument();
  });

  it("shows persisted storage without a warning or an export prompt", async () => {
    await requestPersistence({ persist: async () => true, persisted: async () => true });

    render(<StoragePanel workspaceId="ws-1" />);
    fireEvent.click(screen.getByTestId("storage-status"));

    expect(screen.getByTestId("storage-persist")).toHaveTextContent("agreed not to evict");
    expect(screen.queryByTestId("storage-warning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("storage-export")).not.toBeInTheDocument();
  });

  it("publishes the offline scope in the UI", () => {
    render(<StoragePanel workspaceId="ws-1" />);
    fireEvent.click(screen.getByTestId("storage-status"));
    expect(screen.getByTestId("offline-scope")).toHaveTextContent(
      "Offline means the open tab keeps working",
    );
    expect(screen.getByTestId("offline-scope")).toHaveTextContent(
      "reload while offline is not supported",
    );
  });

  it("raises a visible state and keeps the document when a write is refused for quota", async () => {
    // A full origin is a typed state, not a silent save.
    useDurabilityStore.getState().noteQuotaExceeded("out of quota");

    render(<StoragePanel workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByTestId("storage-status")).toHaveTextContent("full"));

    fireEvent.click(screen.getByTestId("storage-status"));
    expect(screen.getByTestId("quota-warning")).toHaveRole("alert");
    expect(screen.getByTestId("quota-warning")).toHaveTextContent("out of quota");
    expect(screen.getByTestId("storage-export")).toBeInTheDocument();
  });
});

describe("quota classification", () => {
  it("recognises the quota error names and codes browsers use", () => {
    expect(isQuotaExceeded(new DOMException("full", "QuotaExceededError"))).toBe(true);
    expect(isQuotaExceeded({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe(true);
    expect(isQuotaExceeded({ code: 22 })).toBe(true);
    expect(isQuotaExceeded(new Error("something else"))).toBe(false);
    expect(isQuotaExceeded(null)).toBe(false);
  });

  it("formats the estimate a person can read", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 * 12)).toBe("12 MB");
    expect(formatEstimate({ usage: null, quota: null })).toBe("unknown");
    expect(formatEstimate({ usage: 2048, quota: 4096 })).toBe("2 KB of 4 KB");
  });
});
