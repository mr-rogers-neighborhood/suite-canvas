import { docsLlms } from "@/lib/source";

export const revalidate = false;

/** Every page, in full, in one file. */
export async function GET() {
  return new Response(await docsLlms.full(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
