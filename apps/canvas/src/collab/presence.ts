export interface PresenceUser {
  name: string;
  color: string;
}

export interface PointerState {
  x: number;
  y: number;
}

export interface FocusState {
  nodeId: string;
}

export const AWARENESS_FIELDS = {
  user: "user",
  pointer: "pointer",
  focus: "focus",
} as const;

export interface PeerPresence {
  clientId: number;
  user: PresenceUser;
  pointer: PointerState | null;
  focus: FocusState | null;
}
