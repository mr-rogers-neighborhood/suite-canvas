import { useMemo } from "react";
import { useDurabilityStore } from "../storage/durability";
import { type StorageLadder, storageLadder } from "./storageLadder";

/**
 * The ladder bound to the live durability state.
 *
 * One hook so the status panel and the leave guard both answer from the same `storageLadder()` call
 * with the same inputs ([ADR-0025](../../../docs/decisions/0025-client-durability-and-offline-scope.md)
 * amendment). Assembling the inputs separately per surface is how a second rule gets invented.
 */
export function useStorageLadder(signedIn: boolean, synced: boolean): StorageLadder {
  const persist = useDurabilityStore((state) => state.persist);
  const quota = useDurabilityStore((state) => state.quota);

  return useMemo(
    () => storageLadder({ persist, signedIn, synced, failing: quota !== null }),
    [persist, signedIn, synced, quota],
  );
}
