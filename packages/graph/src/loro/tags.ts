import { tagFromMap } from "../records/entities.js";
import { isMap } from "../records/values.js";
import { type Tag, tagSchema } from "../schema.js";
import { STRUCT_ORIGIN } from "./constants.js";
import type { DocContext } from "./context.js";

/**
 * Owns tags: the flat label vocabulary a board, section or card may carry.
 *
 * Plain functions over the shared DocContext: the facade delegates here,
 * and modules reach each other through `ctx.api`.
 */
export function tagsMethods(ctx: DocContext) {
  return {
    cachedTag(id: string): Tag | undefined {
      const cached = ctx.tagCache.get(id);
      if (cached) return cached;
      const value = ctx.tags.get(id);
      if (!isMap(value)) return undefined;
      const tag = tagFromMap(id, value);
      ctx.tagCache.set(id, tag);
      return tag;
    },

    listTags(): Tag[] {
      return ctx.tags
        .keys()
        .map((id) => ctx.api.tags.cachedTag(id))
        .filter((tag): tag is Tag => tag !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    },

    getTag(id: string): Tag | undefined {
      return ctx.api.tags.cachedTag(id);
    },

    findTagByName(name: string): Tag | undefined {
      const needle = name.trim().toLocaleLowerCase();
      if (!needle) return undefined;
      return ctx.api.tags.listTags().find((tag) => tag.name.toLocaleLowerCase() === needle);
    },

    createTag(input: { name: string; color?: string }): Tag {
      const name = input.name.trim();
      if (!name) throw new Error("A tag needs a name");
      if (ctx.api.tags.findTagByName(name)) throw new Error(`Tag already exists: ${name}`);
      return ctx.api.tags.writeNewTag(name, input.color);
    },

    /** Returns the existing tag when the name matches case-insensitively. */
    ensureTag(name: string): Tag {
      return ctx.api.tags.findTagByName(name) ?? ctx.api.tags.createTag({ name });
    },

    writeNewTag(name: string, color?: string): Tag {
      const tag = tagSchema.parse({
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
        ...(color ? { color } : {}),
      });
      const fields = ctx.tags.ensureMergeableMap(tag.id);
      fields.set("name", tag.name);
      fields.set("createdAt", tag.createdAt);
      if (tag.color) fields.set("color", tag.color);
      ctx.commit(`${STRUCT_ORIGIN}tag`);
      return tag;
    },

    renameTag(id: string, name: string): void {
      const next = name.trim();
      if (!next) throw new Error("A tag needs a name");
      const existing = ctx.api.tags.findTagByName(next);
      if (existing && existing.id !== id) throw new Error(`Tag already exists: ${next}`);
      const fields = ctx.tags.get(id);
      if (!isMap(fields)) return;
      fields.set("name", next);
      ctx.commit(`${STRUCT_ORIGIN}tag`);
    },

    /** Removes the record; card memberships stay dormant until the tag returns. */
    deleteTag(id: string): void {
      if (ctx.tags.get(id) === undefined) return;
      ctx.tags.delete(id);
      ctx.commit(`${STRUCT_ORIGIN}tag`);
    },
  };
}
