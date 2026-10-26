import { useEffect, useRef } from "react";

/**
 * The native tab-close prompt ([ADR-0025](../../../docs/decisions/0025-client-durability-and-offline-scope.md)
 * amendment).
 *
 * The in-app dialog can only catch a return to the launcher; closing the tab has no such moment, so
 * the same at-risk state also registers this listener. The browser owns the wording, which is why
 * nothing here tries to explain the risk — the dialog is where that sentence lives.
 *
 * `active` is the state (`banner` and not already leaving). `shouldPrompt` is asked at the moment of
 * the close, not at registration: a navigation the reader explicitly chose ("Leave anyway", an export
 * that leaves, sign-in) sets it false, and the native prompt must not then ask a second time.
 */
export function useBeforeUnload(active: boolean, shouldPrompt: () => boolean = alwaysPrompt): void {
  const promptRef = useRef(shouldPrompt);

  useEffect(() => {
    promptRef.current = shouldPrompt;
  }, [shouldPrompt]);

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!promptRef.current()) return;
      // Both are needed: Chrome reads `returnValue`, and Firefox/Safari raise the
      // prompt because the listener called `preventDefault`.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}

function alwaysPrompt(): boolean {
  return true;
}
