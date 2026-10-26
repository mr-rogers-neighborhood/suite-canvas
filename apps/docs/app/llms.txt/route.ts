import { docsLlms } from "@/lib/source";

export const revalidate = false;

/** The index an agent reads first: every page title, URL and description. */
export async function GET() {
  return new Response(await docsLlms.index(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
