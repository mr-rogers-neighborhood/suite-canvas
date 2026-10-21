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

export const AWARENESS_FIELDS = {
  user: "user",
  pointer: "pointer",
  focus: "focus",
  dragging: "dragging",
} as const;

export interface PeerPresence {
  clientId: number;
  user: PresenceUser;
  pointer: PointerState | null;
  focus: FocusState | null;
  dragging: DraggingState | null;
}
