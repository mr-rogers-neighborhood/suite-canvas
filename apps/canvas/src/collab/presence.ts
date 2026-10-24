export interface PresenceUser {
  name: string;
  color: string;
}

/** Canvas position in React Flow (flow) coordinates. */
export interface PointerState {
  x: number;
  y: number;
}

export interface FocusState {
  nodeId: string;
  /** Which editor on the card the caret is in. */
  field?: "title" | "body";
}

/** The node a peer is dragging, plus its live flow position. */
export interface DraggingState {
  nodeId: string;
  position: PointerState;
  /**
   * Every card moving in the gesture, anchor included. Peers derive the other
   * members from their stored placement plus this anchor's delta, so the drag
   * stays a single payload instead of per-node streaming.
   */
  nodeIds?: string[];
  /**
   * Board the gesture runs on. A card may be placed on more than one board, so
   * the scene needs to know which placement `position` belongs to; the flat
   * flow surface can derive it from the peer's board and leaves this unset.
   */
  boardId?: string;
}

/** A connector a peer has clicked, so peers can see who is working on it. */
export interface ConnectorSelection {
  nodeId: string;
  connectorId: string;
}

/** Cards, links and the connector a peer has selected (not necessarily editing). */
export interface SelectionState {
  nodeIds: string[];
  edgeIds?: string[];
  connector?: ConnectorSelection;
  sectionId?: string;
}

/** A connector a peer is dragging along a card perimeter. */
export interface ConnectorState {
  nodeId: string;
  connectorId: string;
  /** Live perimeter fraction while the drag is in flight; peers ease toward it. */
  position?: { x: number; y: number };
}

/** A live marquee a peer is dragging, in flow units. */
export interface SelectionBoxState {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A section a peer is dragging, with its live top-left in flow units. */
export interface SectionDragState {
  sectionId: string;
  position: PointerState;
}

/** A section a peer is resizing, in flow units. */
export interface SectionResizeState {
  sectionId: string;
  position: PointerState;
  width: number;
  height: number;
}

/** A card a peer is resizing, in flow units. */
export interface ResizingState {
  nodeId: string;
  /**
   * Top-left corner while the gesture runs. Resizing from the top or left edge
   * moves the node as well, so the size alone cannot reproduce the gesture.
   */
  position: PointerState;
  width: number;
  height: number;
  /** Board the gesture runs on; see `DraggingState.boardId`. */
  boardId?: string;
}

/** A link end a peer is dragging toward another connector. */
export interface ReconnectState {
  edgeId: string;
  /** The end that follows the pointer; the other one stays anchored. */
  end: "source" | "target";
  /** Pointer position in flow coordinates. */
  position: { x: number; y: number };
  /** Connector React Flow has snapped the dragged end to, if any. */
  target?: ConnectorSelection;
}

/** A link's label a peer is sliding along the link's path. */
export interface LabelDragState {
  edgeId: string;
  /** Fraction of the path the label sits at, 0..1. */
  offset: number;
}

/** A link a peer is dragging out of one connector toward another. */
export interface ConnectState {
  /** Card the gesture starts from; the pointer drags the other end. */
  nodeId: string;
  /** Connector on that card the finished link will attach to. */
  connectorId: string;
  /** Which end of the eventual link the anchor is; the pointer is the other end. */
  anchorEnd: "source" | "target";
  /** Pointer position in flow coordinates. */
  position: { x: number; y: number };
  /** Connector React Flow has snapped the dragged end to, if any. */
  target?: ConnectorSelection;
}

export const AWARENESS_FIELDS = {
  board: "board",
  /**
   * The deepest Board under the peer's pointer. `board` names what the peer is
   * *looking at* (the View); this names what they are *in*, which a View cannot
   * say because it flattens every Board into one plane.
   */
  boardOf: "boardOf",
  user: "user",
  pointer: "pointer",
  focus: "focus",
  dragging: "dragging",
  selection: "selection",
  selectionBox: "selectionBox",
  connector: "connector",
  resizing: "resizing",
  sectionDrag: "sectionDrag",
  sectionResize: "sectionResize",
  reconnect: "reconnect",
  connect: "connect",
  labelDrag: "labelDrag",
} as const;

export interface PeerPresence {
  clientId: string;
  /** Board the peer is looking at; presence from other boards is ignored. */
  board: string | null;
  /**
   * The Board the peer's pointer is inside, or null on the plane. Attribution,
   * not filtering: a peer in another Board of this View is still visible, and
   * saying which Board they are in is the point.
   */
  boardOf: string | null;
  user: PresenceUser;
  pointer: PointerState | null;
  focus: FocusState | null;
  dragging: DraggingState | null;
  selection: SelectionState | null;
  /** Marquee a peer is drawing right now, so collaborators see the gesture. */
  selectionBox: SelectionBoxState | null;
  connector: ConnectorState | null;
  resizing: ResizingState | null;
  sectionDrag: SectionDragState | null;
  sectionResize: SectionResizeState | null;
  reconnect: ReconnectState | null;
  connect: ConnectState | null;
  labelDrag: LabelDragState | null;
}

/** True while a peer is actively editing or manipulating something. */
export function peerIsInteracting(peer: PeerPresence): boolean {
  return Boolean(
    peer.focus ||
      peer.dragging ||
      peer.resizing ||
      peer.sectionDrag ||
      peer.sectionResize ||
      peer.connector ||
      peer.reconnect ||
      peer.connect ||
      peer.labelDrag ||
      peer.selectionBox,
  );
}

/** `#rgb` / `#rrggbb` to channels; anything else is not a colour. */
function parseHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((start) => Number.parseInt(full.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/**
 * Presence colours are picked by people, so a chip cannot assume white ink:
 * pick the side of the chip that clears 4.5:1 on whatever colour it was given.
 * Lives here — not in the chip component — so a non-React surface (the ICE
 * presence layer) can ink its chips the same way.
 */
export function presenceChipInk(color: string): string {
  const rgb = parseHex(color);
  if (!rgb) return "#ffffff";
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb;
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  // 0.179 is where black and white text swap places for a 4.5:1 target.
  return luminance > 0.179 ? "#1d1d1f" : "#ffffff";
}
