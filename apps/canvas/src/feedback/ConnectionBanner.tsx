import { useCanvasStore } from "../store/useCanvasStore";
import "../styles/feedback.css";
import { useConnectionBannerState } from "./connection";

/**
 * The relay, said out loud: offline with the edits that have not been sent, a
 * reconnect in progress, a refusal, and a short confirmation when the room is
 * back. The title bar's dot answers the same question in one word; this banner
 * is where the consequence and the count live.
 *
 * `role="status"` is deliberate: every change of state here is news, and it is
 * never urgent enough to interrupt what a person is reading.
 */
export function ConnectionBanner() {
  const state = useConnectionBannerState();

  if (state.kind === "hidden") return null;

  const retry = () => useCanvasStore.getState().connect();

  return (
    <div
      className="connection-banner"
      data-testid="connection-banner"
      data-kind={state.kind}
      data-tone={state.kind === "offline" || state.kind === "refused" ? "warning" : undefined}
      role="status"
      aria-live="polite"
    >
      <span className="connection-banner__dot" aria-hidden="true" />
      {state.kind === "offline" ? (
        <>
          <span>Offline. Edits stay in this browser.</span>
          <PendingCount count={state.pending} word="unsent" />
          <button
            type="button"
            className="connection-banner__action"
            data-testid="connection-retry"
            onClick={retry}
          >
            Try now
          </button>
        </>
      ) : null}
      {state.kind === "reconnecting" ? (
        <>
          <span>Reconnecting…</span>
          <PendingCount count={state.pending} word="sending" />
        </>
      ) : null}
      {state.kind === "refused" ? (
        <>
          <span>Not syncing: this workspace refused this browser's access.</span>
          <PendingCount count={state.pending} word="unsent" />
        </>
      ) : null}
      {state.kind === "reconnected" ? <span>Reconnected. Everything is in sync.</span> : null}
    </div>
  );
}

function PendingCount({ count, word }: { count: number; word: "unsent" | "sending" }) {
  if (count === 0) return null;
  return (
    <span className="connection-banner__count" data-testid="connection-pending">
      {count} {word} {count === 1 ? "change" : "changes"}
    </span>
  );
}
