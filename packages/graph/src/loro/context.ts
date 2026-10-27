import { type LoroDoc, type LoroMap, UndoManager } from "loro-crdt";
import type { Board, Card, CardType, GraphEdge, Placement, Section, Tag } from "../schema.js";
import type { SavedView } from "../views.js";
import type { DocApi } from "./api.js";
import { INDEX_ORIGIN, INIT_ORIGIN, STRUCT_ORIGIN, TEXT_ORIGIN_PREFIX } from "./constants.js";
import { STRUCT_KEYS } from "./keys.js";
import type { CardContainers, WorkspaceChange, WorkspaceSection } from "./model.js";

/** The root maps of one document, opened by the facade that owns their keys. */
export interface DocRoots {
  boards: LoroMap;
  cards: LoroMap;
  placements: LoroMap;
  edges: LoroMap;
  types: LoroMap;
  tags: LoroMap;
  sections: LoroMap;
  content: LoroMap;
  titles: LoroMap;
  references: LoroMap;
  meta: LoroMap;
  viewsMap: LoroMap;
  drawings: LoroMap;
}

/**
 * The maps, caches, listeners and commit plumbing of one workspace document.
 * Domain modules take this and write through it; nothing else holds state.
 */
export class DocContext {
  readonly doc: LoroDoc;
  readonly boards: LoroMap;
  readonly cards: LoroMap;
  readonly placements: LoroMap;
  readonly edges: LoroMap;
  readonly types: LoroMap;
  readonly tags: LoroMap;
  readonly sections: LoroMap;
  readonly content: LoroMap;
  readonly titles: LoroMap;
  readonly references: LoroMap;
  readonly meta: LoroMap;
  readonly viewsMap: LoroMap;
  readonly drawings: LoroMap;
  readonly cardCache = new Map<string, Card>();
  readonly placementCache = new Map<string, Placement>();
  readonly edgeCache = new Map<string, GraphEdge>();
  readonly boardCache = new Map<string, Board>();
  readonly typeCache = new Map<string, CardType>();
  readonly tagCache = new Map<string, Tag>();
  readonly sectionCache = new Map<string, Section>();
  readonly viewCache = new Map<string, SavedView>();
  readonly referenceCache = new Map<string, string[]>();
  readonly pendingReferences = new Set<string>();
  referencesScheduled = false;
  batchOrigin: string | null = null;
  readonly undoManager: UndoManager;
  readonly known: Record<WorkspaceSection, Set<string>>;
  readonly listeners = new Set<(change: WorkspaceChange) => void>();
  readonly metaListeners = new Set<() => void>();
  readonly viewListeners = new Set<() => void>();
  viewRevision = 0;
  readonly containerCache = new Map<string, CardContainers>();
  readonly containerListeners = new Map<string, Set<() => void>>();
  readonly titleListeners = new Map<string, Set<() => void>>();

  /** Built by `createDocApi` right after construction; modules call each other through it. */
  api!: DocApi;

  constructor(doc: LoroDoc, roots: DocRoots) {
    this.doc = doc;
    this.boards = roots.boards;
    this.cards = roots.cards;
    this.placements = roots.placements;
    this.edges = roots.edges;
    this.types = roots.types;
    this.tags = roots.tags;
    this.sections = roots.sections;
    this.content = roots.content;
    this.titles = roots.titles;
    this.references = roots.references;
    this.meta = roots.meta;
    this.viewsMap = roots.viewsMap;
    this.drawings = roots.drawings;
    this.known = {
      boards: new Set(this.boards.keys()),
      cards: new Set(this.cards.keys()),
      placements: new Set(this.placements.keys()),
      edges: new Set(this.edges.keys()),
      types: new Set(this.types.keys()),
      tags: new Set(this.tags.keys()),
      sections: new Set(this.sections.keys()),
      references: new Set(this.references.keys()),
    };

    this.undoManager = new UndoManager(doc, {
      mergeInterval: 0,
      maxUndoSteps: 100,
      excludeOriginPrefixes: [TEXT_ORIGIN_PREFIX, INIT_ORIGIN, "text:", INDEX_ORIGIN],
    });
    // A negative interval means never: one gesture is one change, so the oplog's
    // granularity matches the undo stack's. Loro otherwise folds continuous
    // same-message commits from the same second into one change, which would hide
    // a point the history panel could otherwise restore.
    doc.setChangeMergeInterval(-1);
  }

  /** Starts the doc subscription once the domain api exists. */
  attach(): void {
    attachDocSubscription(this);
  }

  batch<T>(origin: string, fn: () => T): T {
    if (this.batchOrigin !== null) return fn();
    this.batchOrigin = origin;
    try {
      return fn();
    } finally {
      this.batchOrigin = null;
      this.commit(origin);
    }
  }

  /**
   * One commit per gesture. The origin is also stored as the change's message:
   * Loro keeps the merge into one change only when the message matches, and the
   * history panel reads that message to say what a point changed.
   */
  commit(origin = `${STRUCT_ORIGIN}write`): void {
    if (this.batchOrigin !== null) return;
    this.doc.commit({ origin, message: origin, timestamp: Math.floor(Date.now() / 1000) });
  }

  invalidate(section: WorkspaceSection, key: string): void {
    switch (section) {
      case "boards":
        this.boardCache.delete(key);
        break;
      case "cards":
        this.cardCache.delete(key);
        break;
      case "placements":
        this.placementCache.delete(key);
        break;
      case "edges":
        this.edgeCache.delete(key);
        break;
      case "types":
        this.typeCache.delete(key);
        break;
      case "tags":
        this.tagCache.delete(key);
        break;
      case "sections":
        this.sectionCache.delete(key);
        break;
      case "references":
        this.referenceCache.delete(key);
        break;
    }
  }

  readSection(section: WorkspaceSection, key: string): WorkspaceChange["value"] {
    switch (section) {
      case "boards":
        return this.api.boards.getBoard(key) ?? null;
      case "cards":
        return this.api.cards.getCard(key) ?? null;
      case "placements":
        return this.api.placements.getPlacementByKey(key) ?? null;
      case "edges":
        return this.api.edges.getEdge(key) ?? null;
      case "types":
        return this.api.cardTypes.getType(key) ?? null;
      case "tags":
        return this.api.tags.getTag(key) ?? null;
      case "sections":
        return this.api.sections.getSection(key) ?? null;
      case "references": {
        const targets = this.api.cards.referencesFor(key);
        return targets.length > 0 ? targets : null;
      }
    }
  }
}

/** Fans doc events out to the caches, listeners and derived indexes. */
function attachDocSubscription(ctx: DocContext): void {
  ctx.doc.subscribe((batch) => {
    let metaTouched = false;
    const touched = new Map<WorkspaceSection, Set<string>>();
    const containers = new Set<string>();
    const savedViews = new Set<string>();
    for (const event of batch.events) {
      const root = event.path[0];
      if (typeof root !== "string") continue;
      if (root === STRUCT_KEYS.content || root === STRUCT_KEYS.titles) {
        if (typeof event.path[1] === "string") containers.add(event.path[1]);
        else if (event.diff.type === "map") {
          for (const key of Object.keys(event.diff.updated)) containers.add(key);
        }
        continue;
      }
      if (root === STRUCT_KEYS.meta) {
        // The workspace's own name and navigation live here. They are not a
        // snapshot section, so readers of them subscribe separately.
        metaTouched = true;
        continue;
      }
      if (root === STRUCT_KEYS.views) {
        if (typeof event.path[1] === "string") savedViews.add(event.path[1]);
        else if (event.diff.type === "map") {
          for (const key of Object.keys(event.diff.updated)) savedViews.add(key);
        }
        continue;
      }
      if (
        root !== STRUCT_KEYS.boards &&
        root !== STRUCT_KEYS.cards &&
        root !== STRUCT_KEYS.placements &&
        root !== STRUCT_KEYS.edges &&
        root !== STRUCT_KEYS.types &&
        root !== STRUCT_KEYS.tags &&
        root !== STRUCT_KEYS.sections &&
        root !== STRUCT_KEYS.references
      ) {
        continue;
      }
      const section = root as WorkspaceSection;
      const keys = touched.get(section) ?? new Set<string>();
      if (typeof event.path[1] === "string") {
        keys.add(event.path[1]);
      } else if (event.diff.type === "map") {
        for (const key of Object.keys(event.diff.updated)) keys.add(key);
      }
      touched.set(section, keys);
    }
    for (const cardId of containers) {
      const before = ctx.containerCache.get(cardId);
      ctx.containerCache.delete(cardId);
      const after = ctx.api.cards.cardContainers(cardId);
      // Text edits also land here; only a container appearing or disappearing
      // changes what an editor needs to mount.
      if (before && before.contentId === after.contentId && before.titleId === after.titleId) {
        ctx.containerCache.set(cardId, before);
      } else {
        const listeners = ctx.containerListeners.get(cardId);
        if (listeners) for (const listener of listeners) listener();
      }
      const titles = ctx.titleListeners.get(cardId);
      if (titles) for (const listener of titles) listener();
    }
    // Derived index: re-parse every card whose text changed. Our own index
    // writes are skipped so a write cannot schedule another one.
    if (containers.size > 0 && batch.origin !== INDEX_ORIGIN) {
      for (const cardId of containers) ctx.pendingReferences.add(cardId);
      ctx.api.cards.scheduleReferences();
    }
    if (savedViews.size > 0) {
      for (const viewId of savedViews) ctx.viewCache.delete(viewId);
      ctx.viewRevision += 1;
      for (const listener of ctx.viewListeners) listener();
    }
    if (metaTouched) for (const listener of ctx.metaListeners) listener();
    if (touched.size === 0) return;
    for (const [section, keys] of touched) {
      for (const key of keys) {
        const existed = ctx.known[section].has(key);
        ctx.invalidate(section, key);
        const value = ctx.readSection(section, key);
        if (value === null) ctx.known[section].delete(key);
        else ctx.known[section].add(key);
        const change: WorkspaceChange = {
          section,
          action: value === null ? "delete" : existed ? "update" : "add",
          key,
          value,
        };
        for (const listener of ctx.listeners) listener(change);
      }
    }
  });
}
