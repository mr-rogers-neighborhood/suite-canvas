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
}

/** The node a peer is dragging, plus its live flow position. */
export interface DraggingState {
  nodeId: string;
  position: PointerState;
}

/** Cards and links a peer has selected (not necessarily editing). */
export interface SelectionState {
  nodeIds: string[];
  edgeIds?: string[];
}

/** A connector a peer is dragging along a card perimeter. */
export interface ConnectorState {
  nodeId: string;
  connectorId: string;
  /** Live perimeter fraction while the drag is in flight; peers ease toward it. */
  position?: { x: number; y: number };
}

/** A link end a peer is dragging toward another connector. */
export interface ReconnectState {
  edgeId: string;
  /** The end that follows the pointer; the other one stays anchored. */
  end: "source" | "target";
  /** Pointer position in flow coordinates. */
  position: { x: number; y: number };
}

export const AWARENESS_FIELDS = {
  user: "user",
  pointer: "pointer",
  focus: "focus",
  dragging: "dragging",
  selection: "selection",
  connector: "connector",
  reconnect: "reconnect",
} as const;

export interface PeerPresence {
  clientId: number;
  user: PresenceUser;
  pointer: PointerState | null;
  focus: FocusState | null;
  dragging: DraggingState | null;
  selection: SelectionState | null;
  connector: ConnectorState | null;
  reconnect: ReconnectState | null;
}
