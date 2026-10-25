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
export function isChaining(input: { shiftKey?: boolean | undefined; linkMode: LinkMode }): boolean {
  return input.shiftKey === true || input.linkMode === "thread";
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

interface LinkThreadState {
  armed: LinkConnectorRef | null;
  arm: (ref: LinkConnectorRef | null) => void;
  clear: () => void;
}

/**
 * The armed end of a thread. It lives beside the connector layer because both
 * node faces and the section layer chain through it, and thread state is UI
 * state — it is never written to the document.
 */
export const useLinkThreadStore = create<LinkThreadState>((set) => ({
  armed: null,
  arm: (armed) => set({ armed }),
  clear: () => set({ armed: null }),
}));

/** True when this connector is the armed end of a thread. */
export function isArmed(armed: LinkConnectorRef | null, ref: LinkConnectorRef): boolean {
  return armed !== null && sameConnector(armed, ref);
}
