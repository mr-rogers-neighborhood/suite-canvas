import { createFromSource } from "fumadocs-core/search/server";
import { getSource } from "@/lib/source";

// The source reads the Markdown from disk, so the index is built per request
// instead of being exported once at build time (`staticGET`).
const search = createFromSource(getSource);

export const GET = search.GET;
