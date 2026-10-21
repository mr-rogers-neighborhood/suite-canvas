import type { Connector } from "./schema.js";

/** Magnet points on the card perimeter: 4 corners plus 4 side midpoints. */
export const CONNECTOR_ANCHORS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 0.5 },
  { x: 1, y: 1 },
  { x: 0.5, y: 1 },
  { x: 0, y: 1 },
  { x: 0, y: 0.5 },
];

export function createConnectorId(): string {
  return crypto.randomUUID();
}

export function snapToAnchor(position: { x: number; y: number }): { x: number; y: number } {
  let best = CONNECTOR_ANCHORS[0] as { x: number; y: number };
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const anchor of CONNECTOR_ANCHORS) {
    const distance = (anchor.x - position.x) ** 2 + (anchor.y - position.y) ** 2;
    if (distance < bestDistance) {
      best = anchor;
      bestDistance = distance;
    }
  }

  return { ...best };
}

/** The four side midpoints every new note starts with. */
export function defaultConnectors(): Connector[] {
  return [
    { x: 0.5, y: 0 },
    { x: 1, y: 0.5 },
    { x: 0.5, y: 1 },
    { x: 0, y: 0.5 },
  ].map((anchor) => ({ id: createConnectorId(), ...anchor }));
}

/** First anchor that has no connector yet, so "Add connector" never stacks. */
export function nextFreeAnchor(connectors: Connector[]): { x: number; y: number } {
  const used = new Set(connectors.map((connector) => `${connector.x}:${connector.y}`));
  const free = CONNECTOR_ANCHORS.find((anchor) => !used.has(`${anchor.x}:${anchor.y}`));
  return free ? { ...free } : { x: 0.5, y: 0 };
}
