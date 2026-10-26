import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

/**
 * Copies each section's served `<folder>.md` to `<folder>/index.md`.
 *
 * A Starlight entry id collapses a folder index, so the Markdown route for
 * `tutorials/index.md` is `/tutorials.md`. The bodies in `docs/` link to each
 * other by file path (`./index.md`), which resolves to `/tutorials/index.md`
 * from a sibling page. Serving that path too keeps every relative link in the
 * Markdown output resolvable, including the ones `llms-full.txt` carries.
 */
async function indexFiles(directory: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await indexFiles(path, found);
    } else if (entry.name === "index.md") {
      found.push(path);
    }
  }
  return found;
}

export function markdownIndexCopies(): AstroIntegration {
  let contentDir = "";
  return {
    name: "suite:markdown-index-copies",
    hooks: {
      "astro:config:done": ({ config }) => {
        contentDir = fileURLToPath(new URL("content/docs/", config.srcDir));
      },
      "astro:build:done": async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        let copied = 0;
        for (const file of await indexFiles(contentDir)) {
          const folder = relative(contentDir, dirname(file)).split(sep).join("/");
          if (folder === "" || folder === ".") continue;
          await mkdir(join(root, folder), { recursive: true });
          await copyFile(join(root, `${folder}.md`), join(root, folder, "index.md"));
          copied += 1;
        }
        logger.info(`wrote ${copied} Markdown index copies`);
      },
    },
  };
}
