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

    // The status line is a status even when the browser will not promise to keep the copy.
    expect(screen.getByTestId("storage-status")).toHaveTextContent("Saved on this device");
    expect(screen.getByTestId("storage-status")).not.toHaveTextContent("temporarily");

    // The risk lives beside it, with the action that fixes it.
    expect(screen.getByTestId("storage-persist")).toHaveTextContent("not promised to keep");
    expect(screen.getByTestId("storage-headline")).toHaveTextContent(
      "Sign in to keep this workspace anywhere",
    );
    expect(screen.getByTestId("storage-warning")).toBeInTheDocument();
    expect(screen.getByTestId("storage-export")).toBeInTheDocument();
  });

  it("shows persisted storage without a warning or an export prompt", async () => {
    await requestPersistence({ persist: async () => true, persisted: async () => true });

    render(<StoragePanel workspaceId="ws-1" />);

    expect(screen.getByTestId("storage-persist")).toHaveTextContent("agreed to keep the copy");
    expect(screen.queryByTestId("storage-warning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("storage-export")).not.toBeInTheDocument();
  });

  it("publishes the offline scope in the UI", () => {
    render(<StoragePanel workspaceId="ws-1" />);
    expect(screen.getByTestId("offline-scope")).toHaveTextContent(
      "Offline means the open tab keeps working",
    );
    expect(screen.getByTestId("offline-scope")).toHaveTextContent(
      "Reloading while offline needs the network",
    );
    expect(screen.getByTestId("offline-scope")).toHaveTextContent("ships no service worker");
  });

  it("raises a visible state and keeps the document when a write is refused for quota", async () => {
    // A full origin is a typed state, not a silent save.
    useDurabilityStore.getState().noteQuotaExceeded("out of quota");

    render(<StoragePanel workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByTestId("storage-status")).toHaveTextContent("full"));

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

describe("storage panel and the account", () => {
  beforeEach(() => {
    useDurabilityStore.getState().reset();
  });

  it("hands the banner's one action to whoever mounts it", async () => {
    await requestPersistence({ persist: async () => false, persisted: async () => false });
    const onSignIn = vi.fn();

    render(<StoragePanel workspaceId="ws-1" signedIn={false} onSignIn={onSignIn} />);

    expect(screen.getByTestId("storage-headline")).toHaveTextContent(
      "Sign in to keep this workspace anywhere",
    );
    fireEvent.click(screen.getByTestId("storage-sign-in"));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("offers the durability gesture while the browser has not promised, and not after", async () => {
    // `denied` is included on purpose: a real click is what browsers weigh, so trying again
    // from a gesture is the point rather than a wasted press.
    await requestPersistence({ persist: async () => false, persisted: async () => false });
    const { unmount } = render(<StoragePanel workspaceId="ws-1" />);
    expect(screen.getByTestId("storage-request-persist")).toHaveTextContent(
      "Keep a copy on this device",
    );
    unmount();

    // Once the browser has agreed, there is nothing left to ask for.
    await requestPersistence({ persist: async () => true, persisted: async () => true });
    render(<StoragePanel workspaceId="ws-1" />);
    expect(screen.queryByTestId("storage-request-persist")).not.toBeInTheDocument();
  });

  it("shows no sign-in action when nothing is wired to it", async () => {
    await requestPersistence({ persist: async () => false, persisted: async () => false });
    render(<StoragePanel workspaceId="ws-1" />);
    expect(screen.queryByTestId("storage-sign-in")).not.toBeInTheDocument();
  });

  it("stays quiet for an anonymous reader while another device is in the room", async () => {
    // The sign-in banner asks for something because this browser may be the only
    // copy. In a live room it is not, and the author's note was explicit that
    // warnings during collaboration are disruptive.
    await requestPersistence({ persist: async () => false, persisted: async () => false });
    render(<StoragePanel workspaceId="ws-1" synced />);

    expect(screen.getByTestId("storage-status")).toHaveTextContent("Saved here and synced");
    expect(screen.queryByTestId("storage-warning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("storage-sign-in")).not.toBeInTheDocument();
  });

  it("stops asking once the device has an account", async () => {
    await requestPersistence({ persist: async () => false, persisted: async () => false });
    const onSignIn = vi.fn();

    render(<StoragePanel workspaceId="ws-1" signedIn onSignIn={onSignIn} />);

    expect(screen.queryByTestId("storage-sign-in")).not.toBeInTheDocument();
    expect(screen.getByTestId("storage-headline")).toHaveTextContent("synced");
  });

  it("says nothing at all when the account's copy makes the browser's copy a footnote", async () => {
    await requestPersistence({ persist: async () => true, persisted: async () => true });
    render(<StoragePanel workspaceId="ws-1" signedIn />);

    expect(screen.queryByTestId("storage-headline")).not.toBeInTheDocument();
    expect(screen.getByTestId("storage-status")).toHaveTextContent("Saved");
    expect(screen.queryByTestId("storage-warning")).not.toBeInTheDocument();
  });
});
