import { useEffect, useState } from "react";
import { getSession, type SessionConfig } from "../session/session";
import { useDurabilityStore } from "../storage/durability";
import { useCanvasStore } from "../store/useCanvasStore";

/**
 * Local persistence, answered separately from the relay.
 *
 * The sync dot conflates the two: a tab can be `Synced` to the relay while its
 * IndexedDB write is refused, and a standalone build is durable with no relay at
 * all. These are the only three answers this device can give about its own copy.
 */
export type SaveState = "saved" | "saving" | "not-durable";

/**
 * How long a local commit reads as "saving". The update row is appended in the
 * same tick, so this is the settle window for the read-back, not a queue.
 */
export const SAVE_SETTLE_MS = 600;

/** Whether this tab writes the document to this browser at all. */
export function localPersistenceAvailable(session: SessionConfig = getSession()): boolean {
  return typeof indexedDB !== "undefined" && session.roomId !== null;
}

export function saveStateOf(input: {
  ready: boolean;
  saving: boolean;
  durable: boolean;
  quota: boolean;
}): SaveState {
  // A refused write is the strongest fact there is: the copy is in this tab and
  // nowhere else, whatever hydration and the relay say.
  if (!input.durable || input.quota) return "not-durable";
  if (!input.ready) return "saving";
  return input.saving ? "saving" : "saved";
}

/**
 * `durable` is a parameter so a test can place the hook on a device that stores
 * the document; production callers never pass it.
 */
export function useSaveState(durable: boolean = localPersistenceAvailable()): SaveState {
  const workspace = useCanvasStore((state) => state.workspace);
  const ready = useCanvasStore((state) => state.ready);
  const quota = useDurabilityStore((state) => state.quota !== null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = workspace.doc.subscribeLocalUpdates(() => {
      setSaving(true);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setSaving(false);
      }, SAVE_SETTLE_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [workspace]);

  return saveStateOf({ ready, saving, durable, quota });
}
