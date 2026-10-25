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
  /**
   * Liveness of an in-flight gesture, as a counter the sender bumps while it
   * holds one. A gesture is refreshed only when its payload *changes*, so a peer
   * that presses and holds without moving would age out of everyone's view; the
   * beat is what says "still here" without pretending anything moved.
   */
  gestureBeat: "gestureBeat",
} as const;

export interface PeerPresence {
  clientId: string;
  /** Board the peer is looking at; presence from other boards is ignored. */
  board: string | null;
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
  /** Sender's liveness counter for an in-flight gesture; see `gestureBeat`. */
  gestureBeat?: number;
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
