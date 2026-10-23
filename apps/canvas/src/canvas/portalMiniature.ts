import type { Placement, Section } from "@suite/graph";

/** Card box assumed when a placement has never been resized. */
export const MINIATURE_CARD_SIZE = { width: 224, height: 160 } as const;
/**
 * Room around the content, in flow units. Zooming out to a miniature should
 * show the board floating inside its frame, not cropped at the edges.
 */
const PADDING = 36;
/** Bounds never collapse below a card, so one lone card still reads as a board. */
const MIN_BOUNDS = { width: 360, height: 240 };
/** Longest side of the normalised miniature; the other side keeps the aspect. */
const UNIT = 100;
/** Cards drawn at most; `cardCount` still reports the whole board. */
const MAX_CARDS = 240;

export interface MiniatureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MiniatureSection extends MiniatureRect {
  sectionId: string;
  color?: Section["color"];
}

export interface MiniatureCard extends MiniatureRect {
  cardId: string;
}

export interface BoardMiniatureModel {
  /** Normalised coordinate space every rect is expressed in. */
  viewBox: { width: number; height: number };
  sections: MiniatureSection[];
  cards: MiniatureCard[];
  /** Cards on the target board, including any beyond the drawing cap. */
  cardCount: number;
  empty: boolean;
}

/** A peer dot on a miniature, in the model's normalised coordinates. */
export interface MiniatureDot {
  x: number;
  y: number;
  color: string;
  label: string;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The flow-space box that holds everything on a board, padded and centred so
 * the same number drives the miniature's view box and the camera's fit.
 */
export function boardBounds(
  sections: readonly Section[],
  placements: readonly Placement[],
): MiniatureRect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;

  const grow = (x: number, y: number, width: number, height: number) => {
    any = true;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  };

  for (const placement of placements) {
    grow(
      placement.x,
      placement.y,
      placement.width ?? MINIATURE_CARD_SIZE.width,
      placement.height ?? MINIATURE_CARD_SIZE.height,
    );
  }
  for (const section of sections) grow(section.x, section.y, section.width, section.height);

  if (!any) return null;

  const contentWidth = Math.max(maxX - minX, MIN_BOUNDS.width);
  const contentHeight = Math.max(maxY - minY, MIN_BOUNDS.height);
  const width = contentWidth + PADDING * 2;
  const height = contentHeight + PADDING * 2;
  // Centring the content inside the padded, minimum-sized box keeps a lone card
  // off the corner and makes the fit-to-viewport viewport agree with the drawing.
  return {
    x: minX - (width - (maxX - minX)) / 2,
    y: minY - (height - (maxY - minY)) / 2,
    width,
    height,
  };
}

/**
 * A static miniature of one board, derived from the same snapshot the canvas
 * reads. Nothing here is stored: a target board that changes redraws the model.
 */
export function boardMiniature(
  sections: readonly Section[],
  placements: readonly Placement[],
): BoardMiniatureModel {
  const bounds = boardBounds(sections, placements);
  if (!bounds) {
    return {
      viewBox: { width: UNIT, height: round((UNIT * MIN_BOUNDS.height) / MIN_BOUNDS.width) },
      sections: [],
      cards: [],
      cardCount: 0,
      empty: true,
    };
  }

  const scale = UNIT / Math.max(bounds.width, bounds.height);
  const map = (rect: MiniatureRect): MiniatureRect => ({
    x: round((rect.x - bounds.x) * scale),
    y: round((rect.y - bounds.y) * scale),
    width: round(rect.width * scale),
    height: round(rect.height * scale),
  });

  const orderedSections = [...sections].sort(
    (a, b) => a.z - b.z || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const orderedPlacements = [...placements].sort(
    (a, b) => a.z - b.z || a.createdAt - b.createdAt || a.cardId.localeCompare(b.cardId),
  );

  return {
    viewBox: { width: round(bounds.width * scale), height: round(bounds.height * scale) },
    sections: orderedSections.map((section) => ({
      ...map(section),
      sectionId: section.id,
      ...(section.color ? { color: section.color } : {}),
    })),
    cards: orderedPlacements.slice(0, MAX_CARDS).map((placement) => ({
      ...map({
        x: placement.x,
        y: placement.y,
        width: placement.width ?? MINIATURE_CARD_SIZE.width,
        height: placement.height ?? MINIATURE_CARD_SIZE.height,
      }),
      cardId: placement.cardId,
    })),
    cardCount: placements.length,
    empty: placements.length === 0 && sections.length === 0,
  };
}

/**
 * Peers reading a card on the target board become dots at that card's centre.
 * A peer who is only on the board (no focused card) has nowhere to sit; their
 * avatar rides on the portal card instead.
 */
export function miniatureDots(
  model: BoardMiniatureModel,
  peers: readonly { focus?: { nodeId: string } | null; user: { color: string; name: string } }[],
): MiniatureDot[] {
  if (model.cards.length === 0) return [];
  const byCard = new Map(model.cards.map((card) => [card.cardId, card]));
  const dots: MiniatureDot[] = [];
  for (const peer of peers) {
    const cardId = peer.focus?.nodeId;
    if (!cardId) continue;
    const rect = byCard.get(cardId);
    if (!rect) continue;
    dots.push({
      x: round(rect.x + rect.width / 2),
      y: round(rect.y + rect.height / 2),
      color: peer.user.color,
      label: peer.user.name,
    });
  }
  return dots;
}

/**
 * Section band fill: the same token the canvas sections use, thinned out the
 * same way. A miniature is a hint of the board, not a saturated diagram.
 */
export function miniatureSectionColor(color?: Section["color"]): string {
  return `color-mix(in srgb, var(--section-${color ?? "slate"}) 18%, transparent)`;
}
