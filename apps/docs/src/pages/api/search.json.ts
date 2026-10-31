import type { APIRoute } from "astro";
import { createFromSource } from "fumadocs-core/search/server";
import { docsSource } from "../../lib/source";

/**
 * The static search index for the developer pages.
 *
 * `staticGET` exports the whole index as a file, which is what makes search work on a static host:
 * no search service, and a preview deploy answers the same queries as production. The handbook is
 * navigated by its own sidebar and searched inside the app.
 */
export const prerender = true;

const server = createFromSource(docsSource);

export const GET: APIRoute = () => server.staticGET();
