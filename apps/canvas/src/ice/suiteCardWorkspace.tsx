/**
 * Production slot renderer for the `suite.card` kind: mounts the real Suite card
 * shell over ICE's GPU object.
 *
 * The card UI is not re-implemented here. `CardSurface` already is the product
 * face — the real `NodeCard`, its Tiptap title/body bound to the workspace's Loro
 * containers, its type glyph, its property/tag chips, its menu and inspector
 * wiring, and the app's global CSS. This module supplies only the two things the
 * overlay cannot: the React root per slot, and the canonical `Card`/`CardType`/
 * `CardMeta` resolved from the live workspace stores.
 *
 * Read-only: ICE owns pointer input on the desk (the overlay is
 * `pointer-events:none`), and the workspace surface beside it may be editing the
 * same card. `readOnly` on `CardSurface` keeps the twin from offering a second
 * editor or a second menu; the renderer creates no document and writes nothing
 * on mount.
 *
 * The overlay is the one geometry source: it sizes each slot from `geometryOf()`
 * and scales it by the camera. This renderer only fills the box it is given.
 *
 * Every band renders, because the DOM face is now the only face a Suite card
 * has: `full` mounts the product face, `compact` a static glyph/title/chips
 * face, and `icon` the glyph alone. The static bands read the card record and
 * its type only — never the text containers — so they mount no editor.
 *
 * Presence is the one thing the twin adds: a peer whose caret is in this card
 * gets a small "editing" chip in the card's corner, so an inspector-first
 * session still shows who is typing where. The chip is a label, not an editor.
 */

import type { CardType, Tag } from "@suite/graph";
import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { type CardMeta, cardMeta } from "../cards/cardMeta";
import { resolveCardType, typesById } from "../cards/cardTypes";
import type { PeerPresence } from "../collab/presence";
import { CardSurface } from "../components/CardSurface";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCard, useWorkspaceSnapshot } from "../store/workspaceStore";
import type { SuiteCardBand, SuiteCardInfo, SuiteCardSlotRenderer } from "./suiteCardOverlay";

/** Names a chip row shows before it collapses the rest into "+N". */
export const EDITING_CHIP_NAMES = 2;

/**
 * Peers whose caret is inside this card, in a stable order: presence arrives as
 * an object keyed by client, so without the sort a repaint could reshuffle the
 * chips. `useBoardPeers` has already scoped the list to the card's board.
 */
export function editingPeersFor(cardId: string, peers: readonly PeerPresence[]): PeerPresence[] {
  return peers
    .filter((peer) => peer.focus?.nodeId === cardId)
    .sort((a, b) => a.user.name.localeCompare(b.user.name) || a.clientId.localeCompare(b.clientId));
}

export interface EditingChipSummary {
  /** The peers that get a named chip, at most `EDITING_CHIP_NAMES`. */
  readonly shown: readonly PeerPresence[];
  /** How many more peers are editing, for the "+N" chip. */
  readonly hidden: number;
}

/** Split editing peers into their named chips and the "+N" remainder. */
export function editingChipsFor(
  peers: readonly PeerPresence[],
  max = EDITING_CHIP_NAMES,
): EditingChipSummary {
  const shown = peers.slice(0, Math.max(0, max));
  return { shown, hidden: Math.max(0, peers.length - shown.length) };
}

/** Meta chips the compact face has room for. */
export const COMPACT_META_CHIPS = 2;

/** A slot without a band predates banding: it gets the full face. */
function bandOf(info: SuiteCardInfo): SuiteCardBand {
  return info.band ?? "full";
}

export interface CompactMetaChip {
  readonly key: string;
  readonly label: string;
}

/**
 * The compact face's meta row: property values first, then tag names, capped at
 * `max`. A field with no value never reaches `CardMeta`, so this only has to
 * truncate.
 */
export function compactMetaChips(meta: CardMeta, max = COMPACT_META_CHIPS): CompactMetaChip[] {
  const chips: CompactMetaChip[] = [];
  for (const property of meta.properties) {
    if (chips.length >= max) break;
    chips.push({
      key: `field:${property.fieldId}`,
      label: `${property.label}: ${property.value}`,
    });
  }
  for (const name of meta.tags) {
    if (chips.length >= max) break;
    chips.push({ key: `tag:${name}`, label: `#${name}` });
  }
  return chips;
}

/**
 * The overlay lays each slot out in world units and scales the whole content by
 * the camera, so card chrome would shrink with the card. The slot's own
 * transform is that camera scale; undoing it keeps the chip at screen size, the
 * way `--scene-chrome-scale` does for React Flow's presence chrome.
 */
function useChromeScale(ref: RefObject<HTMLElement | null>): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    // The root mounts into the slot's content element, which carries the scale.
    const slot = ref.current?.parentElement ?? null;
    if (!slot) return;
    const read = () => {
      const matrix = /^matrix\(([^,]+),/.exec(getComputedStyle(slot).transform);
      const painted = matrix ? Number.parseFloat(matrix[1] ?? "") : 1;
      const next = Number.isFinite(painted) && painted > 0 ? 1 / painted : 1;
      setScale((current) => (Math.abs(current - next) < 1e-3 ? current : next));
    };
    read();
    // The overlay rewrites the slot transform on every camera change.
    const observer = new MutationObserver(read);
    observer.observe(slot, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, [ref]);

  return scale;
}

const CHIPS_STYLE: CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  gap: 4,
  maxWidth: "70%",
  pointerEvents: "none",
  transformOrigin: "top right",
};

const CHIP_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  minWidth: 0,
  padding: "1px 6px",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  background: "color-mix(in srgb, var(--surface) 92%, transparent)",
  color: "var(--ink-muted)",
  fontSize: 10,
  fontWeight: 500,
  lineHeight: "14px",
  whiteSpace: "nowrap",
};

const CHIP_NAME_STYLE: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/** One chip per editing peer, plus a "+N" chip; a label, never an editor. */
function EditingChips({ cardId, summary }: { cardId: string; summary: EditingChipSummary }) {
  const ref = useRef<HTMLDivElement>(null);
  const chromeScale = useChromeScale(ref);

  return (
    <div
      ref={ref}
      data-testid="suite-card-editing-chips"
      data-card-id={cardId}
      aria-hidden="true"
      style={{ ...CHIPS_STYLE, transform: `scale(${chromeScale})` }}
    >
      {summary.shown.map((peer) => (
        <span
          key={peer.clientId}
          data-testid="suite-card-editing-chip"
          data-peer-name={peer.user.name}
          style={CHIP_STYLE}
        >
          <span
            style={{
              width: 6,
              height: 6,
              flex: "none",
              borderRadius: "50%",
              background: peer.user.color,
            }}
          />
          <span style={CHIP_NAME_STYLE}>{peer.user.name}</span>
        </span>
      ))}
      {summary.hidden > 0 ? (
        <span data-testid="suite-card-editing-more" style={CHIP_STYLE}>
          +{summary.hidden}
        </span>
      ) : null}
    </div>
  );
}

/* ---- Static faces: no editor, no Loro containers, same box and tokens. ---- */

const COMPACT_FACE_STYLE: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  overflow: "hidden",
  padding: "8px 10px",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  background: "var(--surface)",
  color: "var(--ink)",
  pointerEvents: "none",
};

const COMPACT_HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  minWidth: 0,
};

const GLYPH_STYLE: CSSProperties = {
  flex: "none",
  color: "var(--ink-muted)",
  fontSize: 13,
  lineHeight: "16px",
};

const COMPACT_TITLE_STYLE: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  color: "var(--ink)",
  fontSize: 13,
  fontWeight: 600,
  lineHeight: "16px",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const COMPACT_META_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  minWidth: 0,
  overflow: "hidden",
};

const COMPACT_CHIP_STYLE: CSSProperties = {
  maxWidth: "100%",
  overflow: "hidden",
  padding: "0 6px",
  border: "1px solid var(--hairline)",
  borderRadius: 4,
  color: "var(--ink-muted)",
  fontSize: 10,
  lineHeight: "16px",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const ICON_FACE_STYLE: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  background: "var(--surface)",
  color: "var(--ink-muted)",
  pointerEvents: "none",
};

const ICON_GLYPH_STYLE: CSSProperties = {
  color: "var(--ink-muted)",
  fontSize: 20,
  lineHeight: 1,
};

/**
 * The compact band: glyph, display title and at most two meta chips. It reads
 * the card record and its type only — never the text containers, so mounting it
 * costs one row of state and no editor.
 */
function CompactCardFace({
  type,
  title,
  chips,
  width,
  height,
}: {
  type: CardType;
  title: string;
  chips: readonly CompactMetaChip[];
  width: number | null;
  height: number | null;
}) {
  return (
    <div
      data-testid="suite-card-compact"
      data-band="compact"
      style={{ ...COMPACT_FACE_STYLE, width: width ?? "100%", height: height ?? "100%" }}
    >
      <div style={COMPACT_HEADER_STYLE}>
        <span data-testid="suite-card-glyph" aria-hidden="true" style={GLYPH_STYLE}>
          {type.glyph}
        </span>
        <span data-testid="suite-card-title" style={COMPACT_TITLE_STYLE}>
          {title}
        </span>
      </div>
      {chips.length > 0 ? (
        <div style={COMPACT_META_STYLE}>
          {chips.map((chip) => (
            <span key={chip.key} data-testid="suite-card-meta-chip" style={COMPACT_CHIP_STYLE}>
              {chip.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The icon band: the type glyph alone, centred in the card's box. */
function IconCardFace({
  type,
  width,
  height,
}: {
  type: CardType;
  width: number | null;
  height: number | null;
}) {
  return (
    <div
      data-testid="suite-card-icon"
      data-band="icon"
      style={{ ...ICON_FACE_STYLE, width: width ?? "100%", height: height ?? "100%" }}
    >
      <span data-testid="suite-card-glyph" aria-hidden="true" style={ICON_GLYPH_STYLE}>
        {type.glyph}
      </span>
    </div>
  );
}

export interface SuiteCardWorkspaceViewProps {
  /** The workspace card this object stands for; "" renders nothing. */
  readonly cardId: string;
  /** The board the card is placed on; scopes the card's presence and menus. */
  readonly boardId: string;
  /** Detail level; a missing band is a full card. */
  readonly band?: SuiteCardBand | undefined;
  /**
   * The card outgrew the GPU sheet's sharp ceiling, so this DOM face is the
   * crisp one: it gets an opaque ground (the blurred sheet must not show
   * through) and says so for tests and styling.
   */
  readonly escalated?: boolean | undefined;
  /** Projected display title, used by the compact face. */
  readonly title?: string | undefined;
  /** Box in world units, from the overlay's geometry. */
  readonly width?: number | null;
  readonly height?: number | null;
}

/**
 * The live card face for one overlay slot. Every input is the workspace's own:
 * the record from `useCard`, the type and tags from the snapshot, and the meta
 * chips from `cardMeta`. A card that is not in this workspace (deleted, or an id
 * the projection has not hydrated yet) renders nothing rather than a stub that
 * could drift from the document.
 */
export function SuiteCardWorkspaceView({
  cardId,
  boardId,
  band = "full",
  escalated = false,
  title = "",
  width = null,
  height = null,
}: SuiteCardWorkspaceViewProps) {
  const card = useCard(cardId);
  const snapshot = useWorkspaceSnapshot();
  const peers = useBoardPeers(boardId);
  // One index per snapshot identity: a peer editing a card elsewhere leaves the
  // types and tags arrays identical, so these stay cheap.
  const types = useMemo(() => typesById(snapshot.types), [snapshot.types]);
  const tags = useMemo(
    () => new Map<string, Tag>(snapshot.tags.map((tag) => [tag.id, tag])),
    [snapshot.tags],
  );
  const editingPeers = useMemo(() => editingPeersFor(cardId, peers), [cardId, peers]);
  const editingChips = useMemo(() => editingChipsFor(editingPeers), [editingPeers]);

  if (card === undefined) return null;

  const type = resolveCardType(types, card.primaryTypeId);

  // The static bands exist because the GPU face is hidden at these levels: no
  // editor and no text container may mount, so the face projects the card record
  // and its type only.
  if (band === "icon") {
    return <IconCardFace type={type} width={width} height={height} />;
  }

  if (band === "compact") {
    const chips = compactMetaChips(cardMeta(card, types, tags, COMPACT_META_CHIPS));
    return (
      <div
        data-testid="suite-card-workspace"
        style={{ position: "relative", width: "100%", height: "100%" }}
      >
        <CompactCardFace type={type} title={title} chips={chips} width={width} height={height} />
        {editingPeers.length > 0 ? <EditingChips cardId={cardId} summary={editingChips} /> : null}
      </div>
    );
  }

  const meta: CardMeta = cardMeta(card, types, tags);
  // Escalation is only ever decided at `full`, and only there does it mean
  // anything: the real NodeCard's vector text is the crisp stand-in for a sheet
  // the engine would otherwise stretch. The opaque ground keeps that blurred
  // sheet from showing through the DOM face.
  const crisp = band === "full" && escalated;

  return (
    <div
      data-testid="suite-card-workspace"
      data-escalated={crisp ? "true" : undefined}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        ...(crisp ? { background: "var(--surface)" } : {}),
      }}
    >
      <CardSurface
        card={card}
        type={type}
        meta={meta}
        boardId={boardId}
        width={width}
        height={height}
        readOnly
      />
      {editingPeers.length > 0 ? <EditingChips cardId={cardId} summary={editingChips} /> : null}
    </div>
  );
}

/**
 * The seam the kind calls (`setSuiteCardSlotRenderer`). Each slot gets its own
 * React root; the overlay re-mounts that root when the band changes, so a card
 * below the readable width holds no editor at all.
 */
export function createWorkspaceCardSlotRenderer(): SuiteCardSlotRenderer {
  return {
    mount(content: HTMLElement, info: SuiteCardInfo): (() => void) | undefined {
      // No card named: the lab's string-only face, or a projection that resolved
      // no id. There is nothing to bind, so mount no root at all.
      if (info.cardId.length === 0) return undefined;
      const root = createRoot(content);
      root.render(
        <SuiteCardWorkspaceView
          cardId={info.cardId}
          boardId={info.boardId}
          band={bandOf(info)}
          escalated={info.escalated}
          title={info.title}
          width={info.worldWidth}
          height={info.worldHeight}
        />,
      );
      return () => root.unmount();
    },
  };
}
