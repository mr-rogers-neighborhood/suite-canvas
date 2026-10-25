import type { EdgeEndpointKind } from "@suite/graph";
import { create } from "zustand";
import type { LinkMode } from "./linkGesture";

/** One connector being chained from or to. */
export interface LinkConnectorRef {
  kind: Extract<EdgeEndpointKind, "card" | "section">;
  id: string;
  connectorId: string;
}

export interface ThreadStep {
  /** What is armed after this click; null ends the thread. */
  armed: LinkConnectorRef | null;
  /** The link this click completed, when it completed one. */
  link: { from: LinkConnectorRef; to: LinkConnectorRef } | null;
}

/**
 * Whether a click continues a thread rather than selecting one connector.
 * Shift chains in either mode (the Autodesk gesture people already know);
 * thread mode chains without the modifier.
 */
export function isChaining(input: {
  shiftKey?: boolean | undefined;
  /** Held Control (or Command) asks for a web, the way Shift asks for a thread. */
  ctrlKey?: boolean | undefined;
  linkMode: LinkMode;
}): boolean {
  if (input.ctrlKey === true) return true;
  if (input.shiftKey === true) return true;
  return input.linkMode === "thread" || input.linkMode === "web";
}

/** Which mode a gesture is being read as, before the stored mode is consulted. */
export function gestureMode(input: {
  shiftKey?: boolean | undefined;
  ctrlKey?: boolean | undefined;
  linkMode: LinkMode;
}): LinkMode {
  if (input.ctrlKey === true) return "web";
  if (input.shiftKey === true) return "thread";
  return input.linkMode;
}

export function sameConnector(left: LinkConnectorRef, right: LinkConnectorRef): boolean {
  return left.kind === right.kind && left.id === right.id && left.connectorId === right.connectorId;
}

/**
 * One click of a thread. The first click arms; every later click links from the
 * armed connector and arms the one just clicked, so a thread keeps growing from
 * its own tail. Clicking the armed connector again disarms instead of drawing a
 * link from a thing to itself.
 */
export function stepThread(armed: LinkConnectorRef | null, clicked: LinkConnectorRef): ThreadStep {
  if (!armed) return { armed: clicked, link: null };
  if (sameConnector(armed, clicked)) return { armed: null, link: null };
  return { armed: clicked, link: { from: armed, to: clicked } };
}

/**
 * One click of a web. The first click arms the origin; every later click links
 * *from that same origin*, so a hub costs one click per spoke instead of writing
 * a chain that says B→C. Clicking the origin again disarms, which is the only way
 * to end a web without leaving the mode.
 */
export function stepWeb(armed: LinkConnectorRef | null, clicked: LinkConnectorRef): ThreadStep {
  if (!armed) return { armed: clicked, link: null };
  if (sameConnector(armed, clicked)) return { armed: null, link: null };
  return { armed, link: { from: armed, to: clicked } };
}

/** One click of whichever mode is in force. */
export function stepLink(
  mode: LinkMode,
  armed: LinkConnectorRef | null,
  clicked: LinkConnectorRef,
): ThreadStep {
  return mode === "web" ? stepWeb(armed, clicked) : stepThread(armed, clicked);
}

/**
 * Why an origin is armed: a key being held (Shift for a thread, Control for a
 * web), or a mode chosen in the control. Only a held key ends when it is released.
 */
export type ThreadArmSource = "gesture" | "mode";

interface LinkThreadState {
  armed: LinkConnectorRef | null;
  /**
   * How the origin was armed. A gesture-armed one ends when its key is released
   * — the modifier *is* the mode. A mode-armed one lasts until the user turns the
   * mode off, because nothing physical is being held.
   */
  armedBy: ThreadArmSource | null;
  /** When the last arm happened, so a click handler can ignore a gesture's tail. */
  armedAt: number;
  arm: (ref: LinkConnectorRef | null, by?: ThreadArmSource) => void;
  clear: () => void;
}

/**
 * The armed end of a thread. It lives beside the connector layer because both
 * node faces and the section layer chain through it, and thread state is UI
 * state — it is never written to the document.
 */
export const useLinkThreadStore = create<LinkThreadState>((set) => ({
  armed: null,
  armedBy: null,
  armedAt: 0,
  arm: (armed, by = "mode") =>
    set({ armed, armedBy: armed ? by : null, armedAt: armed ? performance.now() : 0 }),
  clear: () => set({ armed: null, armedBy: null }),
}));

/** True when this connector is the armed end of a thread. */
export function isArmed(armed: LinkConnectorRef | null, ref: LinkConnectorRef): boolean {
  return armed !== null && sameConnector(armed, ref);
}
