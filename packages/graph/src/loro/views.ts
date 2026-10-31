import { isMap, readIdSet, readNumber, readString, writeIdSet } from "../records/values.js";
import type { ViewCollection, ViewPresentationKind, ViewQuery, ViewRender } from "../views.js";
import {
  type SavedView,
  savedViewSchema,
  viewCollectionSchema,
  viewQuerySchema,
  viewRenderSchema,
} from "../views.js";
import { STRUCT_ORIGIN } from "./constants.js";
import type { DocContext } from "./context.js";
import type { CreateViewInput } from "./model.js";

/**
 * Owns saved views: the named queries kept beside the boards they read, and the
 * revision counter that tells a renderer a saved view changed.
 *
 * Plain functions over the shared DocContext: the facade delegates here,
 * and modules reach each other through `ctx.api`.
 */
/**
 * The pinned card ids of one view, or undefined when the view has never had any.
 *
 * `undefined` and "an empty list" are different answers: the first means the view was written before pins
 * existed, the second means a reader cleared them.
 */
function readPins(fields: { get: (key: string) => unknown }): string[] | undefined {
  const context = fields.get("context");
  if (!isMap(context)) return undefined;
  const cardIds = context.get("cardIds");
  return isMap(cardIds) ? readIdSet(cardIds) : [];
}

export function viewsMethods(ctx: DocContext) {
  return {
    cachedView(id: string): SavedView | undefined {
      const cached = ctx.viewCache.get(id);
      if (cached) return cached;
      const fields = ctx.viewsMap.get(id);
      if (!isMap(fields)) return undefined;
      const query = fields.get("query");
      const text = isMap(query) ? readString(query, "text") : undefined;
      const parsed = savedViewSchema.safeParse({
        id,
        name: readString(fields, "name") ?? "",
        position: readNumber(fields, "position") ?? 0,
        query: {
          ...(text !== undefined ? { text } : {}),
          typeIds: isMap(query) ? readIdSet(query.get("typeIds")) : [],
          tagIds: isMap(query) ? readIdSet(query.get("tagIds")) : [],
          sectionIds: isMap(query) ? readIdSet(query.get("sectionIds")) : [],
          scope: isMap(query) ? query.get("scope") : undefined,
          groupBySection: isMap(query) ? query.get("groupBySection") : undefined,
          order: isMap(query) ? query.get("order") : undefined,
          ...(isMap(query) && query.get("textScope") !== undefined
            ? { textScope: query.get("textScope") }
            : {}),
          ...(isMap(query) && query.get("groupBy") !== undefined
            ? { groupBy: query.get("groupBy") }
            : {}),
          ...(isMap(query) && query.get("groups") !== undefined
            ? { groups: query.get("groups") }
            : {}),
          ...(isMap(query) && query.get("sorts") !== undefined
            ? { sorts: query.get("sorts") }
            : {}),
        },
        // Everything the view carries beyond its query. Absent fields stay absent, so a view
        // written before kinds and pins existed still reads as the lens it always was.
        ...(fields.get("kind") !== undefined ? { kind: fields.get("kind") } : {}),
        ...(readPins(fields) === undefined ? {} : { context: { cardIds: readPins(fields) ?? [] } }),
        ...(fields.get("lens") !== undefined ? { lens: fields.get("lens") } : {}),
        ...(fields.get("collection") !== undefined ? { collection: fields.get("collection") } : {}),
        ...(fields.get("render") !== undefined ? { render: fields.get("render") } : {}),
      });
      // A hand-edited or corrupt view is skipped, not thrown on: the rest of the
      // document still opens.
      if (!parsed.success) return undefined;
      ctx.viewCache.set(id, parsed.data);
      return parsed.data;
    },

    /** Saved views in menu order: position, then id so every client agrees. */
    listViews(): SavedView[] {
      return ctx.viewsMap
        .keys()
        .map((id) => ctx.api.views.cachedView(id))
        .filter((view): view is SavedView => view !== undefined)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    },

    getView(id: string): SavedView | undefined {
      return ctx.api.views.cachedView(id);
    },

    createView(input: CreateViewInput): SavedView {
      const name = input.name.trim();
      if (!name) throw new Error("A view needs a name");
      const id = input.id ?? crypto.randomUUID();
      if (ctx.viewsMap.get(id) !== undefined) throw new Error(`View already exists: ${id}`);
      const existing = ctx.api.views.listViews();
      const last = existing.at(-1);
      const view = savedViewSchema.parse({
        id,
        name,
        position: input.position ?? (last ? last.position + 1 : 0),
        query: input.query,
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.context === undefined ? {} : { context: input.context }),
        ...(input.lens === undefined ? {} : { lens: input.lens }),
        ...(input.collection === undefined ? {} : { collection: input.collection }),
        ...(input.render === undefined ? {} : { render: input.render }),
      });
      ctx.api.views.writeView(view);
      ctx.commit(`${STRUCT_ORIGIN}create-view`);
      return view;
    },

    /**
     * Renames a view.
     *
     * One key of one record. A rename is the smallest possible edit, which is why it is not routed through
     * a whole-record replace: two people renaming different views, or one renaming while another edits the
     * query, must not overwrite each other.
     */
    renameView(id: string, name: string): SavedView | undefined {
      const fields = ctx.viewsMap.get(id);
      if (!isMap(fields)) return undefined;
      const trimmed = name.trim();
      if (!trimmed) throw new Error("A view needs a name");
      fields.set("name", trimmed);
      ctx.commit(`${STRUCT_ORIGIN}rename-view`);
      return ctx.api.views.getView(id);
    },

    /**
     * Writes only the query keys the caller changed.
     *
     * The storage has always been per key (`text`, `scope`, each id set, the JSON slots); the old
     * `updateView` rebuilt the whole query from a stale copy and wrote every key back, which is what made
     * two people editing one view clobber each other. A patch that names a key owns that key and nothing
     * else, so concurrent edits to different facets converge.
     */
    patchViewQuery(id: string, patch: Partial<ViewQuery>): SavedView | undefined {
      const fields = ctx.viewsMap.get(id);
      if (!isMap(fields)) return undefined;
      const current = ctx.api.views.getView(id);
      if (current === undefined) return undefined;
      // The patch is validated as the query it would produce, so a bad enum is refused before any key is
      // written. Writing first and validating later is how a document ends up holding a scope no reader
      // can interpret.
      viewQuerySchema.parse({ ...current.query, ...patch });
      const query = fields.ensureMergeableMap("query");
      if (patch.text !== undefined) {
        if (patch.text.length === 0) query.delete("text");
        else query.set("text", patch.text);
      }
      if (patch.textScope !== undefined) query.set("textScope", patch.textScope);
      if (patch.scope !== undefined) query.set("scope", patch.scope);
      if (patch.order !== undefined) query.set("order", patch.order);
      if (patch.groupBySection !== undefined) query.set("groupBySection", patch.groupBySection);
      if (patch.groupBy !== undefined) query.set("groupBy", patch.groupBy);
      if (patch.typeIds !== undefined)
        writeIdSet(query.ensureMergeableMap("typeIds"), patch.typeIds);
      if (patch.tagIds !== undefined) writeIdSet(query.ensureMergeableMap("tagIds"), patch.tagIds);
      if (patch.sectionIds !== undefined) {
        writeIdSet(query.ensureMergeableMap("sectionIds"), patch.sectionIds);
      }
      for (const key of ["groups", "sorts"] as const) {
        const value = patch[key];
        if (value === undefined) continue;
        if (value.length === 0) query.delete(key);
        else query.set(key, value);
      }
      ctx.commit(`${STRUCT_ORIGIN}view-query`);
      return ctx.api.views.getView(id);
    },

    /**
     * Sets the kind and its payload in one commit, dropping the other payloads.
     *
     * One payload per kind, because a view that carried a table mode and a chart layout would leave the
     * next client guessing which one the kind names. Kind and payload move together so a reader never sees
     * a render without its layout.
     */
    setViewKind(
      id: string,
      kind: ViewPresentationKind,
      payload?: { collection?: ViewCollection; render?: ViewRender },
    ): SavedView | undefined {
      const fields = ctx.viewsMap.get(id);
      if (!isMap(fields)) return undefined;
      fields.set("kind", kind);
      const next: Record<string, unknown> = {};
      if (kind === "collection") {
        const collection = payload?.collection ?? { mode: "database" as const };
        fields.set("collection", collection);
        fields.delete("render");
        next.collection = collection;
      } else {
        const render = payload?.render ?? { layout: "graph-2d" as const };
        fields.set("render", render);
        fields.delete("collection");
        next.render = render;
      }
      // A lens payload is legacy; a kind edit is the moment to stop carrying one.
      fields.delete("lens");
      ctx.commit(`${STRUCT_ORIGIN}view-kind`);
      return ctx.api.views.getView(id);
    },

    /**
     * Pins are an id set, not a list in one slot.
     *
     * A `context` map keyed by card id means two people pinning at the same time both win, which is what
     * "add this card to the view" means. A JSON array would resolve last-writer-wins and lose one.
     */
    addViewPin(id: string, cardId: string): SavedView | undefined {
      const fields = ctx.viewsMap.get(id);
      if (!isMap(fields)) return undefined;
      const context = fields.ensureMergeableMap("context");
      context.ensureMergeableMap("cardIds").set(cardId, true);
      ctx.commit(`${STRUCT_ORIGIN}view-pin`);
      return ctx.api.views.getView(id);
    },

    removeViewPin(id: string, cardId: string): SavedView | undefined {
      const fields = ctx.viewsMap.get(id);
      if (!isMap(fields)) return undefined;
      const context = fields.get("context");
      if (isMap(context)) context.ensureMergeableMap("cardIds").delete(cardId);
      ctx.commit(`${STRUCT_ORIGIN}view-pin`);
      return ctx.api.views.getView(id);
    },

    clearViewPins(id: string): SavedView | undefined {
      const fields = ctx.viewsMap.get(id);
      if (!isMap(fields)) return undefined;
      fields.delete("context");
      ctx.commit(`${STRUCT_ORIGIN}view-pin`);
      return ctx.api.views.getView(id);
    },

    /** The collection's mode, written on its own so a table can become a grid without a kind write. */
    patchViewCollection(id: string, collection: ViewCollection): SavedView | undefined {
      const fields = ctx.viewsMap.get(id);
      if (!isMap(fields)) return undefined;
      fields.set("collection", viewCollectionSchema.parse(collection));
      ctx.commit(`${STRUCT_ORIGIN}view-collection`);
      return ctx.api.views.getView(id);
    },

    /** The render's layout, measure and grouping, written on their own. */
    patchViewRender(id: string, render: ViewRender): SavedView | undefined {
      const fields = ctx.viewsMap.get(id);
      if (!isMap(fields)) return undefined;
      fields.set("render", viewRenderSchema.parse(render));
      ctx.commit(`${STRUCT_ORIGIN}view-render`);
      return ctx.api.views.getView(id);
    },

    /** Removes the saved query; no card is touched. */
    deleteView(id: string): void {
      if (ctx.viewsMap.get(id) === undefined) return;
      ctx.viewsMap.delete(id);
      ctx.commit(`${STRUCT_ORIGIN}delete-view`);
    },

    /** Moves a view to `position` in the menu, renumbering the rest in one commit. */
    moveView(id: string, position: number): void {
      if (!Number.isFinite(position)) return;
      const views = ctx.api.views.listViews();
      const from = views.findIndex((view) => view.id === id);
      const moving = views[from];
      if (!moving) return;
      views.splice(from, 1);
      views.splice(Math.max(0, Math.min(Math.trunc(position), views.length)), 0, moving);
      views.forEach((view, index) => {
        if (view.position === index) return;
        const fields = ctx.viewsMap.get(view.id);
        if (isMap(fields)) fields.set("position", index);
      });
      ctx.commit(`${STRUCT_ORIGIN}move-view`);
    },

    writeView(view: SavedView): void {
      const fields = ctx.viewsMap.ensureMergeableMap(view.id);
      fields.set("name", view.name);
      fields.set("position", view.position);
      const query = fields.ensureMergeableMap("query");
      if (view.query.text === undefined) query.delete("text");
      else query.set("text", view.query.text);
      query.set("scope", view.query.scope);
      query.set("groupBySection", view.query.groupBySection);
      query.set("order", view.query.order);
      writeIdSet(query.ensureMergeableMap("typeIds"), view.query.typeIds);
      writeIdSet(query.ensureMergeableMap("tagIds"), view.query.tagIds);
      writeIdSet(query.ensureMergeableMap("sectionIds"), view.query.sectionIds);
      // v2 fields. A query is replaced whole (`updateView` takes a new record), so
      // the predicate and sort lists travel as JSON values: one last-writer-wins
      // slot is exactly the semantics a saved query has.
      for (const key of ["textScope", "groupBy"] as const) {
        const value = view.query[key];
        if (value === undefined) query.delete(key);
        else query.set(key, value);
      }
      for (const key of ["groups", "sorts"] as const) {
        const value = view.query[key];
        if (value === undefined || value.length === 0) query.delete(key);
        else query.set(key, value);
      }

      // Everything past the query. A kind and its payload travel as JSON slots for the same reason
      // the predicates do: a saved view is one record, and a whole-record replace is its semantics.
      if (view.kind === undefined) fields.delete("kind");
      else fields.set("kind", view.kind);

      const pins = view.context?.cardIds ?? [];
      if (pins.length === 0) fields.delete("context");
      else writeIdSet(fields.ensureMergeableMap("context").ensureMergeableMap("cardIds"), pins);

      for (const key of ["lens", "collection", "render"] as const) {
        const value = view[key];
        if (value === undefined) fields.delete(key);
        else fields.set(key, value);
      }
    },

    /**
     * Saved views live outside `WorkspaceSection` on purpose: they are workspace
     * configuration that no board, card or paragraph mutation touches, so the
     * snapshot stream and every content subscriber stay as they were.
     */
    observeViews(listener: () => void): () => void {
      ctx.viewListeners.add(listener);
      return () => {
        ctx.viewListeners.delete(listener);
      };
    },

    /** Monotonic count of views-map changes, the snapshot for `useSyncExternalStore`. */
    get viewsRevision(): number {
      return ctx.viewRevision;
    },
  };
}
