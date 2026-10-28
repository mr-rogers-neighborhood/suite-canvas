import type { EdgeEndpointKind } from "@suite/graph";
import { create } from "zustand";
import type { CanvasMode } from "./linkGesture";

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
  /**
   * A click on another port of the thing the thread is already on. The thread
   * enters by the armed port and leaves by the clicked one, so the port moves and
   * nothing is drawn: a card is something a thread passes *through*, and a line
   * from a card to itself says the opposite (ADR-0061 amendment).
   */
  handoff: boolean;
}

/**
 * Whether a click continues a thread rather than selecting one connector.
 * Shift chains in either mode (the Autodesk gesture people already know);
 * thread mode chains without the modifier.
 */
export function isChaining(input: {
  shiftKey?: boolean | undefined;
  /** Held Control (or Command) asks for a fan, the way Shift asks for a thread. */
  ctrlKey?: boolean | undefined;
  mode: CanvasMode;
}): boolean {
  if (input.ctrlKey === true) return true;
  if (input.shiftKey === true) return true;
  return input.mode !== "place";
}

/**
 * The shape a held key asks for, or null when no key is asking for one.
 *
 * Control is the more specific of the two, so it wins when both are down: a web is
 * a bigger claim on the click than a chain.
 */
export function modifierMode(input: {
  shiftKey?: boolean | undefined;
  ctrlKey?: boolean | undefined;
}): CanvasMode | null {
  if (input.ctrlKey === true) return "fan";
  if (input.shiftKey === true) return "thread";
  return null;
}

/**
 * The shape the next click draws: a held key first, then the arm already in hand,
 * and only then the stored mode.
 *
 * The middle term is what keeps a fan a fan. `gestureMode` re-read the stored mode
 * on every click, so a fan started by holding Control became a *thread* the moment
 * the key came up — every spoke after the first left from the connector clicked
 * second instead of from the origin, which is the spaghetti: the graph looked like
 * a chain nobody asked for. An arm is a choice already made, so it outlives the
 * key that made it; ending it is explicit (click the origin, Escape, or leave the
 * mode).
 */
export function stepShape(input: {
  shiftKey?: boolean | undefined;
  ctrlKey?: boolean | undefined;
  mode: CanvasMode;
  armedShape: CanvasMode | null;
}): CanvasMode {
  return modifierMode(input) ?? input.armedShape ?? input.mode;
}

export function sameConnector(left: LinkConnectorRef, right: LinkConnectorRef): boolean {
  return left.kind === right.kind && left.id === right.id && left.connectorId === right.connectorId;
}

/** Whether two ports belong to the same thing, whatever ports they are. */
export function sameEnd(left: LinkConnectorRef, right: LinkConnectorRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

/**
 * One click of a thread. The first click arms; every later click links from the
 * armed connector and arms the one just clicked, so a thread keeps growing from
 * its own tail. Clicking the armed connector again disarms instead of drawing a
 * link from a thing to itself.
 *
 * A *different* port on the same thing is a handoff rather than a loop: the thread
 * entered through the armed port and leaves through the clicked one, which is how
 * "in the top, out the bottom" is expressed without a line through the card.
 */
export function stepThread(armed: LinkConnectorRef | null, clicked: LinkConnectorRef): ThreadStep {
  if (!armed) return { armed: clicked, link: null, handoff: false };
  if (sameConnector(armed, clicked)) return { armed: null, link: null, handoff: false };
  if (sameEnd(armed, clicked)) return { armed: clicked, link: null, handoff: true };
  return { armed: clicked, link: { from: armed, to: clicked }, handoff: false };
}

/**
 * One click of a fan. The first click arms the origin; every later click links
 * *from that same origin*, so a hub costs one click per spoke instead of writing
 * a chain that says B→C. Clicking the origin again disarms, which is the only way
 * to end a fan without leaving the mode.
 *
 * A fan has no route to hand off — every spoke leaves the same port — so a spoke
 * to another port of the origin card is the self-loop it always was.
 */
export function stepFan(armed: LinkConnectorRef | null, clicked: LinkConnectorRef): ThreadStep {
  if (!armed) return { armed: clicked, link: null, handoff: false };
  if (sameConnector(armed, clicked)) return { armed: null, link: null, handoff: false };
  return { armed, link: { from: armed, to: clicked }, handoff: false };
}

/** One click of whichever mode is in force. */
export function stepLink(
  mode: CanvasMode,
  armed: LinkConnectorRef | null,
  clicked: LinkConnectorRef,
): ThreadStep {
  return mode === "fan" ? stepFan(armed, clicked) : stepThread(armed, clicked);
}

/**
 * Why an origin is armed: a key being held (Shift for a thread, Control for a
 * fan), or a mode chosen in the control. Only a held key ends when it is released.
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
  /**
   * The shape the arm draws — `stepShape` outranks the stored mode with it, so a
   * fan started by holding Control stays a fan after the key comes up.
   */
  armedShape: CanvasMode | null;
  /** When the last arm happened, so a click handler can ignore a gesture's tail. */
  armedAt: number;
  /**
   * The connector a click would land on right now, while an arm is held.
   *
   * The armed end of a *thread* moves with every click, so the reader always sees
   * where the next line starts. A fan's origin never moves, so the only useful
   * preview is the other end: this is the dot the next spoke would reach, and the
   * rubber band snaps to it rather than to the bare pointer (ADR-0061).
   */
  target: LinkConnectorRef | null;
  arm: (ref: LinkConnectorRef | null, by?: ThreadArmSource, shape?: CanvasMode | null) => void;
  clear: () => void;
  setTarget: (ref: LinkConnectorRef | null) => void;
}

/**
 * The armed end of a thread. It lives beside the connector layer because both
 * node faces and the section layer chain through it, and thread state is UI
 * state — it is never written to the document.
 */
export const useLinkThreadStore = create<LinkThreadState>((set) => ({
  armed: null,
  armedBy: null,
  armedShape: null,
  armedAt: 0,
  target: null,
  arm: (armed, by = "mode", shape = null) =>
    set({
      armed,
      armedBy: armed ? by : null,
      armedShape: armed ? shape : null,
      armedAt: armed ? performance.now() : 0,
      // A new arm is a new question: the dot hovered before it says nothing about
      // where this one is aimed.
      target: null,
    }),
  clear: () => set({ armed: null, armedBy: null, armedShape: null, target: null }),
  setTarget: (target) =>
    set((state) => (state.armed === null && target !== null ? state : { target })),
}));

/** True when this connector is the armed end of a thread. */
export function isArmed(armed: LinkConnectorRef | null, ref: LinkConnectorRef): boolean {
  return armed !== null && sameConnector(armed, ref);
}
