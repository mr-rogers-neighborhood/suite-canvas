import type { LoroMap } from "loro-crdt";
import {
  createConnectorId,
  defaultConnectors,
  nextFreeAnchor,
  snapToAnchor,
} from "../connectors.js";
import { edgeEndpoints } from "../links.js";
import { sectionFromMap } from "../records/entities.js";
import { isMap, writeIdSet, writeSurfaceStyle } from "../records/values.js";
import { type Connector, type Section, sectionSchema } from "../schema.js";
import type { SurfaceStyle } from "../style.js";
import { CONNECTORS_FIELD, placementKey, STRUCT_ORIGIN } from "./constants.js";
import type { DocContext } from "./context.js";
import type { CreateSectionInput } from "./model.js";

/**
 * Owns sections: geometry, membership, paint, tags and the connectors that draw a
 * section on a board.
 *
 * Plain functions over the shared DocContext: the facade delegates here,
 * and modules reach each other through `ctx.api`.
 */
export function sectionsMethods(ctx: DocContext) {
  return {
    cachedSection(id: string): Section | undefined {
      const cached = ctx.sectionCache.get(id);
      if (cached) return cached;
      const value = ctx.sections.get(id);
      if (!isMap(value)) return undefined;
      const section = sectionFromMap(id, value);
      ctx.sectionCache.set(id, section);
      return section;
    },

    listSections(boardId?: string): Section[] {
      return ctx.sections
        .keys()
        .map((id) => ctx.api.sections.cachedSection(id))
        .filter((section): section is Section => section !== undefined)
        .filter((section) => boardId === undefined || section.boardId === boardId)
        .sort((a, b) => a.z - b.z || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },

    getSection(id: string): Section | undefined {
      return ctx.api.sections.cachedSection(id);
    },

    createSection(input: CreateSectionInput): Section {
      if (!ctx.boards.get(input.boardId)) {
        throw new Error(`Unknown board: ${input.boardId}`);
      }
      const now = Date.now();
      const existing = ctx.api.sections.listSections(input.boardId);
      const section = sectionSchema.parse({
        id: input.id ?? crypto.randomUUID(),
        boardId: input.boardId,
        title: input.title ?? "",
        x: input.x,
        y: input.y,
        width: Math.max(80, input.width ?? 360),
        height: Math.max(60, input.height ?? 260),
        z: existing.length > 0 ? (existing.at(-1)?.z ?? 0) + 1 : 0,
        connectors: input.connectors ?? defaultConnectors(),
        tags: [],
        createdAt: now,
        updatedAt: now,
        ...(input.color ? { color: input.color } : {}),
      });
      ctx.api.sections.writeSection(section);
      ctx.commit(`${STRUCT_ORIGIN}create-section`);
      return section;
    },

    renameSection(id: string, title: string): void {
      const fields = ctx.sections.get(id);
      if (!isMap(fields)) return;
      fields.set("title", title);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}rename-section`);
    },

    /** The section's own icon, which beats nothing: a section has no type to inherit from. */
    setSectionIcon(id: string, icon: string | null): void {
      const fields = ctx.sections.get(id);
      if (!isMap(fields)) return;
      if (icon) fields.set("icon", icon);
      else fields.delete("icon");
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}section-icon`);
    },

    setSectionColor(id: string, color: Section["color"] | null): void {
      const fields = ctx.sections.get(id);
      if (!isMap(fields)) return;
      if (color) fields.set("color", color);
      else fields.delete("color");
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}section-color`);
    },

    /**
     * A section's labels. Like a board's: a queryable grouping, never a rule about
     * which cards belong to the region (ADR-0053 §6).
     */
    setSectionTags(id: string, tagIds: readonly string[]): void {
      const fields = ctx.sections.get(id);
      if (!isMap(fields)) return;
      writeIdSet(fields.ensureMergeableMap("tags"), tagIds);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}section-tags`);
    },

    addSectionTag(id: string, tagId: string): void {
      const section = ctx.api.sections.getSection(id);
      if (!section || section.tags.includes(tagId)) return;
      const fields = ctx.sections.get(id);
      if (!isMap(fields)) return;
      const tags = fields.ensureMergeableMap("tags");
      if (!tags.get(tagId)) tags.set(tagId, true);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}section-tags`);
    },

    removeSectionTag(id: string, tagId: string): void {
      const fields = ctx.sections.get(id);
      if (!isMap(fields)) return;
      const tags = fields.get("tags");
      if (!isMap(tags) || !tags.get(tagId)) return;
      tags.delete(tagId);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}section-tags`);
    },

    /** Paint for a section's frame. A silhouette never changes what it contains. */
    setSectionStyle(id: string, style: SurfaceStyle | null): void {
      const fields = ctx.sections.get(id);
      if (!isMap(fields)) return;
      writeSurfaceStyle(fields, style);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}section-style`);
    },

    updateSectionGeometry(id: string, rect: Pick<Section, "x" | "y" | "width" | "height">): void {
      const fields = ctx.sections.get(id);
      if (!isMap(fields)) return;
      fields.set("x", rect.x);
      fields.set("y", rect.y);
      fields.set("width", Math.max(80, rect.width));
      fields.set("height", Math.max(60, rect.height));
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}resize-section`);
    },

    /**
     * One commit for a section drag: the region, any sections contained by it and
     * every member placement. Members are supplied by the caller from stored
     * geometry so peers and the drag leader agree without extra presence payload.
     */
    moveSectionsBatch(input: {
      sections: {
        id: string;
        x: number;
        y: number;
        width?: number;
        height?: number;
      }[];
      placements?: { boardId: string; cardId: string; x: number; y: number }[];
    }): void {
      const now = Date.now();
      for (const next of input.sections) {
        const fields = ctx.sections.get(next.id);
        if (!isMap(fields)) continue;
        fields.set("x", next.x);
        fields.set("y", next.y);
        if (next.width !== undefined) fields.set("width", Math.max(80, next.width));
        if (next.height !== undefined) fields.set("height", Math.max(60, next.height));
        fields.set("updatedAt", now);
      }
      for (const next of input.placements ?? []) {
        const fields = ctx.placements.get(placementKey(next.boardId, next.cardId));
        if (!isMap(fields)) continue;
        fields.set("x", next.x);
        fields.set("y", next.y);
      }
      ctx.commit(`${STRUCT_ORIGIN}move-section`);
    },

    deleteSection(id: string): void {
      if (ctx.sections.get(id) === undefined) return;
      ctx.api.edges.deleteLinksTo({ kind: "section", id });
      ctx.sections.delete(id);
      ctx.commit(`${STRUCT_ORIGIN}delete-section`);
    },

    addSectionConnector(sectionId: string, position?: { x: number; y: number }): Connector | null {
      const section = ctx.api.sections.getSection(sectionId);
      if (!section) return null;

      const connectors = section.connectors ?? [];
      const anchor = position ?? nextFreeAnchor(connectors);
      const connector: Connector = { id: createConnectorId(), ...anchor };
      const fields = ctx.sections.get(sectionId);
      if (!isMap(fields)) return null;
      const map = fields.ensureMergeableMap(CONNECTORS_FIELD);
      const entry = map.ensureMergeableMap(connector.id);
      entry.set("x", connector.x);
      entry.set("y", connector.y);
      entry.set("order", connectors.length);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}add-section-connector`);
      return connector;
    },

    removeSectionConnector(sectionId: string, connectorId: string): void {
      const section = ctx.api.sections.getSection(sectionId);
      if (!section) return;

      for (const edge of ctx.api.edges.listEdges()) {
        const ends = edgeEndpoints(edge);
        const attached =
          (ends.source.kind === "section" &&
            ends.source.id === sectionId &&
            edge.sourceConnector === connectorId) ||
          (ends.target.kind === "section" &&
            ends.target.id === sectionId &&
            edge.targetConnector === connectorId);
        if (attached) ctx.edges.delete(edge.id);
      }

      const fields = ctx.sections.get(sectionId);
      if (!isMap(fields)) return;
      const map = fields.get(CONNECTORS_FIELD);
      if (isMap(map)) map.delete(connectorId);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}remove-section-connector`);
    },

    moveSectionConnector(
      sectionId: string,
      connectorId: string,
      position: { x: number; y: number },
      options: { snap?: boolean } = {},
    ): void {
      const section = ctx.api.sections.getSection(sectionId);
      if (!section) return;
      const fields = ctx.sections.get(sectionId);
      if (!isMap(fields)) return;
      const map = fields.get(CONNECTORS_FIELD);
      if (!isMap(map)) return;
      const entry = map.get(connectorId);
      if (!isMap(entry)) return;

      const next = options.snap ? snapToAnchor(position) : position;
      entry.set("x", next.x);
      entry.set("y", next.y);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}move-section-connector`);
    },

    writeSection(section: Section): void {
      const fields = ctx.sections.ensureMergeableMap(section.id);
      fields.set("boardId", section.boardId);
      fields.set("title", section.title);
      fields.set("x", section.x);
      fields.set("y", section.y);
      fields.set("width", section.width);
      fields.set("height", section.height);
      fields.set("z", section.z);
      fields.set("createdAt", section.createdAt);
      fields.set("updatedAt", section.updatedAt);
      if (section.color) fields.set("color", section.color);
      if (section.icon) fields.set("icon", section.icon);
      writeIdSet(fields.ensureMergeableMap("tags"), section.tags);
      ctx.api.sections.writeSectionConnectors(fields, section.connectors ?? []);
    },

    writeSectionConnectors(fields: LoroMap, connectors: readonly Connector[]): void {
      const map = fields.ensureMergeableMap(CONNECTORS_FIELD);
      const keep = new Set(connectors.map((connector) => connector.id));
      for (const id of [...map.keys()]) {
        if (!keep.has(id)) map.delete(id);
      }
      connectors.forEach((connector, order) => {
        const entry = map.ensureMergeableMap(connector.id);
        entry.set("x", connector.x);
        entry.set("y", connector.y);
        entry.set("order", order);
      });
    },
  };
}
