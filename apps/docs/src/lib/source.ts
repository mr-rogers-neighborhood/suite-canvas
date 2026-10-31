import { getCollection } from "astro:content";
import { toFumadocsSource } from "@fumadocs/astro/source";
import { loader } from "fumadocs-core/source";

/** The developer pages: `docs/` in the repository, published under `/docs`. */
export const docsSource = loader({
  baseUrl: "/docs",
  source: toFumadocsSource(await getCollection("docs"), await getCollection("docsMeta")),
});

/** The user handbook: `handbook/` in the repository, published under `/handbook`. */
export const handbookSource = loader({
  baseUrl: "/handbook",
  source: toFumadocsSource(await getCollection("handbook"), await getCollection("handbookMeta")),
});
