import { isMap, readIdSet, readNumber, readString, writeIdSet } from "../records/values.js";
import { type SavedView, savedViewSchema } from "../views.js";
import { STRUCT_ORIGIN } from "./constants.js";
import type { DocContext } from "./context.js";
import type { CreateViewInput, UpdateViewInput } from "./model.js";

/**
 * Owns saved views: the named queries kept beside the boards they read, and the
 * revision counter that tells a renderer a saved view changed.
 *
 * Plain functions over the shared DocContext: the facade delegates here,
 * and modules reach each other through `ctx.api`.
 */
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
        ...(fields.get("context") !== undefined ? { context: fields.get("context") } : {}),
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
     * Renames a view and/or replaces its query. The query is a whole record: a
     * view is one saved query, so a facet edit is a new query, not a merge.
     */
    updateView(id: string, patch: UpdateViewInput): SavedView | undefined {
      const current = ctx.api.views.getView(id);
      if (!current) return undefined;
      const name = patch.name === undefined ? current.name : patch.name.trim();
      if (!name) throw new Error("A view needs a name");
      // A whole-record replace, and one payload per kind: switching a view from a lens to a render
      // must not leave the old camera behind to be read by the next client that guesses wrong.
      const next = {
        ...current,
        ...patch,
        name,
        query: patch.query ?? current.query,
      };
      const kind = next.kind ?? "lens";
      if (kind !== "lens") delete next.lens;
      if (kind !== "collection") delete next.collection;
      if (kind !== "render") delete next.render;
      const view = savedViewSchema.parse(next);
      ctx.api.views.writeView(view);
      ctx.commit(`${STRUCT_ORIGIN}update-view`);
      return view;
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
      else fields.set("context", { cardIds: pins });

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
