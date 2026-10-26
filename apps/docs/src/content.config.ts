import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { z } from "astro/zod";

/**
 * Starlight's collection. `scripts/sync-docs.mjs` writes every entry, adding the
 * `title` and `description` Starlight requires and the `lastModified` the
 * dashboard sorts by.
 */
export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        lastModified: z.string().optional(),
      }),
    }),
  }),
};
