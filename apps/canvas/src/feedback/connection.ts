import { useEffect, useRef, useState } from "react";
import { type ConnectionStatus, useCanvasStore } from "../store/useCanvasStore";

/**
 * What the connection banner says, decided without a renderer so each state can
 * be read as a test case.
 *
 * `unauthorized` is a different answer from `disconnected`: the relay is
 * reachable and refused this tab's credential. Saying "offline" there sends a
 * person to check a connection that is working, so the two never collapse into
 * one banner.
 */
export type ConnectionBannerState =
  | { kind: "hidden" }
  | { kind: "offline"; pending: number }
  | { kind: "reconnecting"; pending: number }
  | { kind: "refused"; pending: number }
  | { kind: "reconnected" };

/** How long "Reconnected" stays after a room is live again. */
export const RECONNECTED_MS = 4000;

export function bannerStateOf(
  status: ConnectionStatus,
  pending: number,
  reconnected = false,
): ConnectionBannerState {
  switch (status) {
    case "disconnected":
      return { kind: "offline", pending };
    case "rejoining":
      return { kind: "reconnecting", pending };
    case "unauthorized":
      return { kind: "refused", pending };
    case "connected":
      return reconnected ? { kind: "reconnected" } : { kind: "hidden" };
    case "connecting":
      // A first boot: the title bar already says "Syncing", and a banner for it
      // would flash on every load.
      return { kind: "hidden" };
  }
}

/**
 * Local commits made while the room is not live. They are already in this
 * browser's document and its offline log; the count is what the relay has not
 * seen yet.
 */
export function usePendingChanges(): number {
  const workspace = useCanvasStore((state) => state.workspace);
  const status = useCanvasStore((state) => state.status);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (status === "connected") {
      setPending(0);
      return;
    }
    return workspace.doc.subscribeLocalUpdates(() => setPending((count) => count + 1));
  }, [status, workspace]);

  return pending;
}

/** The reconnected window, and the state the banner renders. */
export function useConnectionBannerState(): ConnectionBannerState {
  const status = useCanvasStore((state) => state.status);
  const pending = usePendingChanges();
  const [reconnected, setReconnected] = useState(false);
  const previous = useRef<ConnectionStatus | null>(null);

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (status !== "connected") {
      setReconnected(false);
      return;
    }
    // A first boot goes `connecting` -> `connected`, and that is not a return.
    const returned = was === "disconnected" || was === "rejoining" || was === "unauthorized";
    if (!returned) return;
    setReconnected(true);
    const timer = setTimeout(() => setReconnected(false), RECONNECTED_MS);
    return () => clearTimeout(timer);
  }, [status]);

  return bannerStateOf(status, pending, reconnected);
}
