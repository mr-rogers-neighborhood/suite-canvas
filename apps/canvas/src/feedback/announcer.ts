import { create } from "zustand";

/**
 * The one place that speaks to a screen reader.
 *
 * Two regions, not one per feature: `LiveRegion` renders exactly these slots, so
 * no amount of new call sites can introduce a second, competing announcement
 * channel. Polite is the default; assertive is reserved for a failure the person
 * has to act on, because it interrupts whatever they were reading.
 *
 * Repeating the identical sentence is a real case (two peers leave, undo twice).
 * A live region only speaks when its text changes, so a repeat is suffixed with
 * an alternating zero-width space — invisible, but a new string to the reader.
 */

export interface Announcement {
  id: number;
  message: string;
  urgent: boolean;
}

interface AnnouncerState {
  polite: Announcement | null;
  assertive: Announcement | null;
  setPolite: (announcement: Announcement) => void;
  setAssertive: (announcement: Announcement) => void;
  reset: () => void;
}

export const useAnnouncerStore = create<AnnouncerState>((set) => ({
  polite: null,
  assertive: null,
  setPolite: (polite) => set({ polite }),
  setAssertive: (assertive) => set({ assertive }),
  reset: () => set({ polite: null, assertive: null }),
}));

/**
 * The window in which an identical sentence is treated as the same event. Two
 * owners of one announcement (a store and the keyboard command that caused it)
 * must not say it twice.
 */
export const REPEAT_WINDOW_MS = 400;

let sequence = 0;
const lastSpoken = { polite: { message: "", at: 0 }, assertive: { message: "", at: 0 } };

export interface AnnounceOptions {
  /** Interrupts the reader. Only for a failure that needs action. */
  urgent?: boolean | undefined;
}

export function announce(message: string, options: AnnounceOptions = {}): void {
  const text = message.trim();
  if (text.length === 0) return;
  const urgent = options.urgent === true;
  const slot = urgent ? "assertive" : "polite";
  const previous = lastSpoken[slot];
  const now = Date.now();
  if (previous.message === text && now - previous.at < REPEAT_WINDOW_MS) return;
  lastSpoken[slot] = { message: text, at: now };
  sequence += 1;
  const announcement: Announcement = { id: sequence, message: text, urgent };
  const store = useAnnouncerStore.getState();
  if (urgent) store.setAssertive(announcement);
  else store.setPolite(announcement);
}

/**
 * The two document commands the structural undo stack owns. The keyboard path
 * lives in `apps/canvas/src/canvas/board/useBoardKeyboard.ts`, which owns the
 * document it undoes, so it reports the direction it ran rather than this layer
 * guessing one from the change itself: Loro commits both directions with the
 * origin `"undo"`, and the effects of an undo and a redo are identical in shape.
 */
export function announceUndo(): void {
  announce("Undo");
}

export function announceRedo(): void {
  announce("Redo");
}

/** Test seam: forget the dedupe window and the slots. */
export function resetAnnouncerForTests(): void {
  sequence = 0;
  lastSpoken.polite = { message: "", at: 0 };
  lastSpoken.assertive = { message: "", at: 0 };
  useAnnouncerStore.getState().reset();
}
