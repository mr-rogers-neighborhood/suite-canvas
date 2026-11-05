import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * The files this machine opened, newest first.
 *
 * It lives in the data directory rather than in the renderer, because the main
 * process is the only thing that knows a file was opened — a renderer that
 * inferred it would be guessing, and a renderer that stored it would lose the
 * list the moment the profile was cleared.
 *
 * The list is a convenience, so an unreadable file is an empty list and never a
 * failure to start. It holds paths, never document content.
 */

export interface RecentFile {
  /** Absolute path, as the shell opened it. */
  readonly path: string;
  readonly name: string;
  readonly openedAt: number;
}

/** Long enough to cover a working week, short enough to scan. */
export const RECENT_LIMIT = 20;

export interface RecentsStore {
  readonly path: string;
  list(): Promise<readonly RecentFile[]>;
  remember(path: string): Promise<void>;
  forget(path: string): Promise<void>;
}

function isRecent(value: unknown): value is RecentFile {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.path === "string" &&
    typeof entry.name === "string" &&
    typeof entry.openedAt === "number"
  );
}

export function recentsStore(dataDirectory: string): RecentsStore {
  const path = join(dataDirectory, "recent-files.json");

  async function write(entries: readonly RecentFile[]): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    // Temp then rename, so a crash mid-write does not cost the history.
    const temp = `${path}.tmp`;
    await writeFile(temp, JSON.stringify(entries.slice(0, RECENT_LIMIT), null, 2));
    await rename(temp, path);
  }

  return {
    path,
    async list() {
      try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isRecent).sort((left, right) => right.openedAt - left.openedAt);
      } catch {
        return [];
      }
    },
    async remember(opened) {
      const existing = await this.list();
      // One row per path: reopening moves the file to the top rather than
      // listing it twice.
      await write([
        { path: opened, name: basename(opened), openedAt: Date.now() },
        ...existing.filter((entry) => entry.path !== opened),
      ]);
    },
    async forget(target) {
      await write((await this.list()).filter((entry) => entry.path !== target));
    },
  };
}
