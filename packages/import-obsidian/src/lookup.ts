/**
 * Owns finding the note a `[[wikilink]]` names, the way Obsidian does: by file
 * name first, then by path, and with the linking note's own folder breaking a
 * tie between two notes of the same name.
 */

export interface NoteLookup {
  path: string;
  cardId: string;
}

export interface ResolvedLink {
  path: string | null;
  cardId: string | null;
  /** True when more than one note carried the name and a guess had to be made. */
  ambiguous: boolean;
}

function key(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export class VaultIndex {
  private readonly byStem = new Map<string, string[]>();
  private readonly byPath = new Map<string, NoteLookup>();
  private readonly byLowerPath = new Map<string, string>();

  /** Registers a note under its file name and its full path. */
  add(path: string, cardId: string): void {
    this.byPath.set(path, { path, cardId });
    this.byLowerPath.set(key(path), path);
    const stem = path.slice(path.lastIndexOf("/") + 1).split(".")[0] ?? path;
    const stemKey = key(stem);
    const existing = this.byStem.get(stemKey) ?? [];
    if (!existing.includes(path)) existing.push(path);
    this.byStem.set(stemKey, existing);
  }

  has(path: string): boolean {
    return this.byPath.has(path);
  }

  cardIdOf(path: string): string | null {
    return this.byPath.get(path)?.cardId ?? null;
  }

  /** Resolves a wikilink target as written, without its `#heading` or alias. */
  resolve(target: string, fromFolder: string): ResolvedLink {
    const name = target.trim().replace(/\.md$/iu, "");
    if (name.length === 0) return { path: null, cardId: null, ambiguous: false };

    const withExtension = `${name}.md`;
    const folderPrefix = fromFolder.length > 0 ? `${fromFolder}/` : "";
    const candidates = name.includes("/")
      ? [withExtension, `${folderPrefix}${withExtension}`, `${folderPrefix}${name}`]
      : [`${folderPrefix}${withExtension}`];

    for (const candidate of candidates) {
      const match = this.byLowerPath.get(key(candidate));
      if (match) return { path: match, cardId: this.cardIdOf(match), ambiguous: false };
    }

    const byStem = this.byStem.get(key(name.split("/").at(-1) ?? name)) ?? [];
    if (byStem.length === 0) {
      // A prefix of a path still finds its note, which is how Obsidian reads a
      // link that names part of the folder structure.
      const suffix = `/${key(withExtension)}`;
      const found = [...this.byLowerPath.keys()].find((path) => path.endsWith(suffix));
      const real = found ? this.byLowerPath.get(found) : undefined;
      return real
        ? { path: real, cardId: this.cardIdOf(real), ambiguous: false }
        : { path: null, cardId: null, ambiguous: false };
    }
    if (byStem.length === 1) {
      const only = byStem[0] as string;
      return { path: only, cardId: this.cardIdOf(only), ambiguous: false };
    }
    const sameFolder = byStem.find((path) => path.slice(0, path.lastIndexOf("/")) === fromFolder);
    const chosen = sameFolder ?? [...byStem].sort((a, b) => a.length - b.length)[0];
    return chosen
      ? { path: chosen, cardId: this.cardIdOf(chosen), ambiguous: true }
      : { path: null, cardId: null, ambiguous: false };
  }
}
