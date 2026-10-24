/**
 * Peer presence, painted.
 *
 * The projection (`icePresence.ts`) turns awareness into screen-space boxes; this
 * module owns the elements. It is a plain DOM layer — no React, no ICE — so the
 * surface can drive it from the frame hook it already runs, and so the whole
 * thing can be tested in jsdom without a WebGPU device.
 *
 * Nothing here decides *what* is visible: an empty frame hides the layer
 * entirely, so an idle canvas carries no presence DOM at all. Each peer item is
 * pooled by its stable key (`cursor:<peer>`, `ring:<peer>:<instance>`, …) and
 * updated in place, so a moving pointer moves one element and keeps its
 * transition instead of rebuilding the layer.
 *
 * The one shape that is not a box is a peer's in-flight link, drawn as an SVG
 * line from the connector they left to their pointer.
 */

import type { Point } from "@suite/scene";
import { type PeerPresence, presenceChipInk } from "../collab/presence";
import {
  EMPTY_ICE_PRESENCE_FRAME,
  type IcePresenceFrame,
  type IcePresenceInstance,
  type IceScreenRect,
  projectPeerPresence,
} from "./icePresence";
import { type SuiteCardCamera, suiteCardBand } from "./suiteCardOverlay";

export interface IcePresenceLayerOptions {
  /** The ICE desk's screen-space container (`ObjectDomHost.container`). */
  readonly container: HTMLElement;
  /** The peer record, read once per `sync()`. */
  readonly peers: () => Readonly<Record<string, PeerPresence>>;
  /** The View being drawn; its id is the presence board every peer is filtered by. */
  readonly boardId: string;
  readonly camera: () => SuiteCardCamera | null | undefined;
  /** The card instances the surface draws, in board units. */
  readonly instances: () => readonly IcePresenceInstance[];
  /** A Board's name, for the "which Board" suffix on a cursor. */
  readonly boardName?: ((boardId: string) => string | undefined) | undefined;
  /** The container's CSS size, for the viewport clip. */
  readonly viewport?:
    | (() => { readonly width: number; readonly height: number } | null)
    | undefined;
  /** A connector's world anchor, so a peer's link preview has a start. */
  readonly anchorOf?: ((cardId: string, connectorId: string) => Point | null) | undefined;
  readonly zIndex?: number | undefined;
}

export interface IcePresenceLayerHandle {
  readonly layer: HTMLElement;
  /** Repaint from the current peers, camera and instances. */
  sync(): void;
  /** Elements currently painted (not counting the layer itself). */
  visibleCount(): number;
  dispose(): void;
}

const LAYER_CLASS = "ice-presence";
const TESTID = "ice-presence-layer";
const SVG_NS = "http://www.w3.org/2000/svg";

function mix(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

function place(el: HTMLElement, rect: IceScreenRect): void {
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}

interface CursorSlot {
  readonly el: HTMLElement;
  readonly label: HTMLElement;
  readonly arrow: SVGPathElement;
}

function createCursor(doc: Document): CursorSlot {
  const el = doc.createElement("div");
  el.dataset.testid = "ice-presence-cursor";
  el.style.cssText =
    "position:absolute;left:0;top:0;pointer-events:none;will-change:transform;transition:transform 60ms linear;";

  const arrow = doc.createElementNS(SVG_NS, "svg");
  arrow.setAttribute("width", "18");
  arrow.setAttribute("height", "18");
  arrow.setAttribute("viewBox", "0 0 16 16");
  arrow.setAttribute("aria-hidden", "true");
  arrow.style.cssText = "display:block;filter:drop-shadow(0 1px 1px rgb(0 0 0 / 0.25));";
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("stroke", "#ffffff");
  path.setAttribute("stroke-width", "1.2");
  path.setAttribute("d", "M3 1.5l9.5 6.2-4.8.6L5 13z");
  arrow.append(path);

  const label = doc.createElement("span");
  label.dataset.testid = "ice-presence-cursor-label";
  label.style.cssText =
    "display:inline-block;margin:-2px 0 0 12px;padding:1px 6px;border-radius:5px;font:500 11px/1.5 system-ui,sans-serif;white-space:nowrap;";

  el.append(arrow, label);
  return { el, label, arrow: path };
}

function createRing(doc: Document): HTMLElement {
  const el = doc.createElement("div");
  el.dataset.testid = "ice-presence-ring";
  el.style.cssText = "position:absolute;pointer-events:none;border-radius:8px;";
  return el;
}

interface GhostSlot {
  readonly el: HTMLElement;
  readonly chip: HTMLElement;
}

function createGhost(doc: Document): GhostSlot {
  const el = doc.createElement("div");
  el.dataset.testid = "ice-presence-ghost";
  el.style.cssText =
    "position:absolute;pointer-events:none;border-radius:8px;border-style:dashed;border-width:1.5px;";
  const chip = doc.createElement("span");
  chip.style.cssText =
    "position:absolute;left:6px;top:-9px;padding:0 5px;border-radius:4px;font:600 10px/1.6 system-ui,sans-serif;";
  el.append(chip);
  return { el, chip };
}

function createBadge(doc: Document): HTMLElement {
  const el = doc.createElement("div");
  el.dataset.testid = "ice-presence-editing";
  el.style.cssText =
    "position:absolute;pointer-events:none;width:9px;height:9px;border-radius:50%;box-shadow:0 0 0 1.5px var(--surface, #ffffff);font:600 8px/9px system-ui,sans-serif;text-align:center;";
  return el;
}

function createMarquee(doc: Document): HTMLElement {
  const el = doc.createElement("div");
  el.dataset.testid = "ice-presence-marquee";
  el.style.cssText =
    "position:absolute;pointer-events:none;border-radius:3px;border-style:dashed;border-width:1px;";
  return el;
}

/**
 * Build the layer. `sync()` is the one frame hook: it projects the peers and
 * reconciles the pooled elements against that frame.
 */
export function createIcePresenceLayer(opts: IcePresenceLayerOptions): IcePresenceLayerHandle {
  const doc = opts.container.ownerDocument;
  const layer = doc.createElement("div");
  layer.className = LAYER_CLASS;
  layer.dataset.testid = TESTID;
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:${
    opts.zIndex ?? 6
  };contain:layout style;`;

  const lines = doc.createElementNS(SVG_NS, "svg");
  lines.dataset.testid = "ice-presence-links";
  lines.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;";
  layer.append(lines);

  const cursors = new Map<string, CursorSlot>();
  const rings = new Map<string, HTMLElement>();
  const ghosts = new Map<string, GhostSlot>();
  const badges = new Map<string, HTMLElement>();
  const marquee: { el: HTMLElement | null } = { el: null };
  let count = 0;

  const reap = <T>(pool: Map<string, T>, seen: Set<string>, element: (value: T) => HTMLElement) => {
    for (const [key, value] of [...pool]) {
      if (seen.has(key)) continue;
      element(value).remove();
      pool.delete(key);
    }
  };

  const paintCursors = (frame: IcePresenceFrame): void => {
    const seen = new Set<string>();
    for (const cursor of frame.cursors) {
      const key = `cursor:${cursor.peerId}`;
      seen.add(key);
      let slot = cursors.get(key);
      if (slot === undefined) {
        slot = createCursor(doc);
        layer.append(slot.el);
        cursors.set(key, slot);
      }
      const board = cursor.boardId === null ? undefined : opts.boardName?.(cursor.boardId);
      slot.el.style.transform = `translate(${cursor.x}px, ${cursor.y}px)`;
      slot.arrow.setAttribute("fill", cursor.color);
      slot.label.textContent = board === undefined ? cursor.name : `${cursor.name} · ${board}`;
      slot.label.style.background = cursor.color;
      slot.label.style.color = presenceChipInk(cursor.color);
    }
    reap(cursors, seen, (slot) => slot.el);
  };

  const paintRings = (frame: IcePresenceFrame): void => {
    const seen = new Set<string>();
    for (const ring of frame.rings) {
      const key = `ring:${ring.peerId}:${ring.instanceKey}`;
      seen.add(key);
      let el = rings.get(key);
      if (el === undefined) {
        el = createRing(doc);
        layer.append(el);
        rings.set(key, el);
      }
      el.style.border = `1.5px solid ${ring.color}`;
      el.style.boxShadow = `0 0 0 2px ${mix(ring.color, 14)}`;
      place(el, ring.rect);
    }
    reap(rings, seen, (el) => el);
  };

  const paintGhosts = (frame: IcePresenceFrame): void => {
    const seen = new Set<string>();
    for (const ghost of frame.ghosts) {
      const key = `ghost:${ghost.peerId}:${ghost.instanceKey}`;
      seen.add(key);
      let slot = ghosts.get(key);
      if (slot === undefined) {
        slot = createGhost(doc);
        layer.append(slot.el);
        ghosts.set(key, slot);
      }
      slot.el.style.borderColor = ghost.color;
      slot.el.style.background = mix(ghost.color, 12);
      slot.chip.textContent = ghost.name;
      slot.chip.style.background = ghost.color;
      slot.chip.style.color = presenceChipInk(ghost.color);
      place(slot.el, ghost.rect);
    }
    reap(ghosts, seen, (slot) => slot.el);
  };

  const paintEditing = (frame: IcePresenceFrame, camera: SuiteCardCamera | null | undefined) => {
    const seen = new Set<string>();
    const instances = opts.instances();
    if (camera === null || camera === undefined || camera.zoom <= 0) {
      reap(badges, seen, (el) => el);
      return;
    }
    const cards = new Map<string, { color: string; count: number }>();
    for (const entry of frame.editing) {
      const instance = instances.find((candidate) => candidate.cardId === entry.cardId);
      if (instance === undefined) continue;
      // The card's own face names its editors at full and compact width; only
      // the icon band has no room for a chip, so a dot stands in there.
      if (suiteCardBand(instance.rect.width * camera.zoom) !== "icon") continue;
      const previous = cards.get(entry.cardId);
      cards.set(entry.cardId, {
        color: entry.peers[0]?.color ?? "#64748b",
        count: (previous?.count ?? 0) + entry.peers.length,
      });
    }
    for (const [cardId, entry] of cards) {
      const instance = instances.find((candidate) => candidate.cardId === cardId);
      if (instance === undefined) continue;
      const key = `editing:${cardId}`;
      seen.add(key);
      let el = badges.get(key);
      if (el === undefined) {
        el = createBadge(doc);
        layer.append(el);
        badges.set(key, el);
      }
      const width = instance.rect.width * camera.zoom;
      el.textContent = entry.count > 1 ? String(entry.count) : "";
      el.setAttribute("data-peer-count", String(entry.count));
      el.style.background = entry.color;
      el.style.color = presenceChipInk(entry.color);
      el.style.left = `${(instance.rect.x - camera.x) * camera.zoom + width - 6}px`;
      el.style.top = `${(instance.rect.y - camera.y) * camera.zoom + 4}px`;
    }
    reap(badges, seen, (el) => el);
  };

  const paintMarquee = (frame: IcePresenceFrame): void => {
    if (frame.marquee === null) {
      marquee.el?.remove();
      marquee.el = null;
      return;
    }
    if (marquee.el === null) {
      marquee.el = createMarquee(doc);
      layer.append(marquee.el);
    }
    marquee.el.style.borderColor = frame.marquee.color;
    marquee.el.style.background = mix(frame.marquee.color, 8);
    place(marquee.el, frame.marquee.rect);
  };

  const paintLinks = (frame: IcePresenceFrame): void => {
    while (lines.firstChild !== null) lines.removeChild(lines.firstChild);
    for (const link of frame.links) {
      const line = doc.createElementNS(SVG_NS, "line");
      line.dataset.testid = "ice-presence-link";
      line.setAttribute("x1", String(link.from.x));
      line.setAttribute("y1", String(link.from.y));
      line.setAttribute("x2", String(link.to.x));
      line.setAttribute("y2", String(link.to.y));
      line.setAttribute("stroke", link.color);
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("stroke-dasharray", "5 4");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("opacity", link.compatible ? "1" : "0.7");
      lines.append(line);
    }
    lines.style.display = frame.links.length === 0 ? "none" : "block";
  };

  const recount = (): void => {
    count =
      cursors.size +
      rings.size +
      ghosts.size +
      badges.size +
      (marquee.el === null ? 0 : 1) +
      lines.childElementCount;
  };

  /** An empty frame leaves no presence DOM behind, only a hidden layer. */
  const clearAll = (): void => {
    for (const slot of cursors.values()) slot.el.remove();
    for (const el of rings.values()) el.remove();
    for (const slot of ghosts.values()) slot.el.remove();
    for (const el of badges.values()) el.remove();
    cursors.clear();
    rings.clear();
    ghosts.clear();
    badges.clear();
    marquee.el?.remove();
    marquee.el = null;
    while (lines.firstChild !== null) lines.removeChild(lines.firstChild);
    count = 0;
  };

  const sync = (): void => {
    const camera = opts.camera();
    const size = opts.viewport?.() ?? null;
    const frame = projectPeerPresence({
      peers: opts.peers(),
      camera,
      boardId: opts.boardId,
      instances: opts.instances(),
      viewport:
        size === null || size.width <= 0 || size.height <= 0
          ? null
          : { left: 0, top: 0, width: size.width, height: size.height },
      ...(opts.anchorOf === undefined ? {} : { anchorOf: opts.anchorOf }),
    });

    if (frame === EMPTY_ICE_PRESENCE_FRAME) {
      clearAll();
      layer.style.display = "none";
      return;
    }
    layer.style.display = "block";
    paintCursors(frame);
    paintRings(frame);
    paintGhosts(frame);
    paintEditing(frame, camera);
    paintMarquee(frame);
    paintLinks(frame);
    recount();
  };

  sync();

  return {
    layer,
    sync,
    visibleCount: () => count,
    dispose() {
      layer.remove();
      cursors.clear();
      rings.clear();
      ghosts.clear();
      badges.clear();
      marquee.el = null;
      count = 0;
    },
  };
}
