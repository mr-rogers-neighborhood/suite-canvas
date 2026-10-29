import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountPhase } from "../auth/useAccountStore";
import type { ConnectionStatus } from "../store/useCanvasStore";

const claim = vi.fn();
const rejoin = vi.fn();
const refreshCredential = vi.fn(async () => Promise.resolve("token"));

vi.mock("../auth/credential", () => ({
  refreshCredential: () => refreshCredential(),
}));
vi.mock("../session/workspaceClaim", () => ({
  claimWorkspaceForAccount: () => claim(),
}));
vi.mock("../session/syncAccess", () => ({
  readSyncRefusal: () => Promise.resolve("plan"),
}));
vi.mock("../store/useCanvasStore", () => ({
  useCanvasStore: { getState: () => ({ rejoin }) },
}));

const { useWorkspaceSyncFacts } = await import("./useWorkspaceSyncFacts");

const signedIn: AccountPhase = "signed-in";
const status: ConnectionStatus = "unauthorized";

beforeEach(() => {
  claim.mockReset();
  rejoin.mockReset();
  refreshCredential.mockReset();
  refreshCredential.mockResolvedValue("token");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useWorkspaceSyncFacts", () => {
  it("should not ask the control plane twice for one answer", async () => {
    claim.mockResolvedValue("capped");
    const { rerender } = renderHook(() =>
      useWorkspaceSyncFacts({ workspaceId: "w1", phase: signedIn, status }),
    );
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));

    rerender();
    await Promise.resolve();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("should post one claim while the first is still in flight", async () => {
    // The effect runs twice in React's strict mode. Both runs used to read an
    // unanswered control plane and both posted, so the loser was told its own
    // workspace belonged to another organization and the badge said "elsewhere".
    let release: (() => void) | undefined;
    claim.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve("claimed");
        }),
    );
    const { result } = renderHook(() =>
      useWorkspaceSyncFacts({ workspaceId: "w1", phase: signedIn, status }),
    );
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));

    // A person pressing Retry while the first answer is still on its way joins that
    // answer rather than racing it.
    act(() => result.current.reclaim());
    await Promise.resolve();
    expect(claim).toHaveBeenCalledTimes(1);

    release?.();
    await waitFor(() => expect(rejoin).toHaveBeenCalled());
  });

  it("should mint a token carrying the new plan before asking again", async () => {
    // The relay enforces the token's own claims. A person who has just paid is still
    // holding the ceiling from before, so a claim that lands and a join that is refused
    // for want of a limit only disagree because nothing re-minted.
    claim.mockResolvedValueOnce("capped").mockResolvedValueOnce("claimed");
    const { result } = renderHook(() =>
      useWorkspaceSyncFacts({ workspaceId: "w1", phase: signedIn, status }),
    );
    await waitFor(() => expect(result.current.claim).toBe("capped"));
    refreshCredential.mockClear();

    act(() => result.current.reclaim());

    await waitFor(() => expect(rejoin).toHaveBeenCalled());
    expect(refreshCredential).toHaveBeenCalledTimes(1);
    // Before the claim, not after: the claim is an authenticated request too, and the
    // join that follows it is the one the stale claims would have broken.
    expect(refreshCredential.mock.invocationCallOrder[0]).toBeLessThan(
      claim.mock.invocationCallOrder[1] as number,
    );
  });

  it("should ask again when a person says they have paid", async () => {
    claim.mockResolvedValueOnce("capped").mockResolvedValueOnce("claimed");
    const { result } = renderHook(() =>
      useWorkspaceSyncFacts({ workspaceId: "w1", phase: signedIn, status }),
    );
    await waitFor(() => expect(result.current.claim).toBe("capped"));

    act(() => result.current.reclaim());

    await waitFor(() => expect(result.current.claim).toBe("claimed"));
    expect(claim).toHaveBeenCalledTimes(2);
    // A claim that lands has to reopen the room: the relay refused it while there was no
    // licence, and the badge saying Synced over a closed socket is worse than Local.
    expect(rejoin).toHaveBeenCalledTimes(1);
  });

  it("should not reopen the room when the answer is still no", async () => {
    claim.mockResolvedValue("capped");
    const { result } = renderHook(() =>
      useWorkspaceSyncFacts({ workspaceId: "w1", phase: signedIn, status }),
    );
    await waitFor(() => expect(result.current.claim).toBe("capped"));

    act(() => result.current.reclaim());
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
    expect(rejoin).not.toHaveBeenCalled();
  });

  it("should ask again when the tab comes back, because a payment elsewhere lands there", async () => {
    claim.mockResolvedValue("capped");
    const { result } = renderHook(() =>
      useWorkspaceSyncFacts({ workspaceId: "w1", phase: signedIn, status }),
    );
    await waitFor(() => expect(result.current.claim).toBe("capped"));

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
  });

  it("should leave a share alone, because the visitor's account is not the owner", async () => {
    const { result } = renderHook(() =>
      useWorkspaceSyncFacts({ workspaceId: "w1", phase: signedIn, status, shared: true }),
    );
    await Promise.resolve();

    act(() => result.current.reclaim());
    expect(claim).not.toHaveBeenCalled();
  });
});
