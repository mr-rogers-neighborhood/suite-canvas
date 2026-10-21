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
}

export const AWARENESS_FIELDS = {
  user: "user",
  pointer: "pointer",
  focus: "focus",
  dragging: "dragging",
  selection: "selection",
  connector: "connector",
} as const;

export interface PeerPresence {
  clientId: number;
  user: PresenceUser;
  pointer: PointerState | null;
  focus: FocusState | null;
  dragging: DraggingState | null;
  selection: SelectionState | null;
  connector: ConnectorState | null;
}
