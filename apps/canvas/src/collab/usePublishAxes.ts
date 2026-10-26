import { useEffect } from "react";
import { useUiStore } from "../store/useUiStore";
import { usePresenceStore } from "./usePresenceStore";

/**
 * Announce the two axes — purpose and gesture — to peers (ADR-0064).
 *
 * They are published here rather than at each control because their readers are
 * everywhere: the mode control, the purpose control, a keyboard shortcut and a
 * library verb can all change them, and a cursor that only updated when one
 * widget was clicked would be wrong for the others. Reading the store and
 * writing to presence keeps that single-sourced.
 *
 * `null` is published explicitly instead of skipped: "explore, place" is the
 * default, and a peer needs to hear that a reader *left* run mode as much as
 * that they entered it.
 */
export function usePublishAxes(): void {
  const purpose = useUiStore((state) => state.purpose);
  const mode = useUiStore((state) => state.mode);
  const setPurpose = usePresenceStore((state) => state.setPurpose);
  const setGesture = usePresenceStore((state) => state.setGesture);

  useEffect(() => {
    setPurpose(purpose);
  }, [purpose, setPurpose]);

  useEffect(() => {
    setGesture(mode);
  }, [mode, setGesture]);
}
