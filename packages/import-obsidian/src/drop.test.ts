import { describe, expect, it } from "vitest";
import { collectVaultFiles, type DroppedEntryLike, type DroppedFileLike } from "./drop.js";

/** The smallest stand-in for a dropped `FileSystemEntry` a test can build. */
function file(name: string, text: string): DroppedEntryLike {
  const handle: DroppedFileLike = { name, size: text.length, text: async () => text };
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (onFile) => onFile(handle),
  };
}

function binary(name: string, size: number): DroppedEntryLike {
  const handle: DroppedFileLike = {
    name,
    size,
    text: async () => {
      throw new Error("bytes should not be read");
    },
  };
  return { isFile: true, isDirectory: false, name, file: (onFile) => onFile(handle) };
}

function folder(name: string, children: DroppedEntryLike[]): DroppedEntryLike {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let served = false;
      return {
        // The real reader reports in batches and ends with an empty one; serving
        // one batch then empty exercises that loop.
        readEntries: (onEntries) => {
          onEntries(served ? [] : children);
          served = true;
        },
      };
    },
  };
}

describe("collectVaultFiles", () => {
  it("reads notes as text and attachments as a size, with paths relative to the drop", async () => {
    const collected = await collectVaultFiles([
      folder("vault", [
        file("Home.md", "# Home\n"),
        folder("Projects", [file("Alpha.md", "# Alpha\n")]),
        binary("diagram.png", 70),
      ]),
    ]);
    expect(collected.files.map((entry) => entry.path)).toEqual([
      "Home.md",
      "Projects/Alpha.md",
      "diagram.png",
    ]);
    expect(collected.files[0]?.text).toContain("Home");
    expect(collected.files[2]?.byteLength).toBe(70);
    expect(collected.skipped).toEqual([]);
  });

  it("keeps a dropped file that sits outside a folder", async () => {
    const collected = await collectVaultFiles([file("Root.md", "Body")]);
    expect(collected.files).toEqual([{ path: "Root.md", text: "Body", byteLength: 4 }]);
  });

  it("reports a note above the size limit instead of truncating it", async () => {
    const collected = await collectVaultFiles([file("Huge.md", "x".repeat(64))], {
      maxBytes: 16,
    });
    expect(collected.files).toEqual([]);
    expect(collected.skipped[0]?.reason).toContain("larger than the 16-byte limit");
  });

  it("reports a folder the browser refuses to read and keeps the rest", async () => {
    const broken: DroppedEntryLike = {
      isFile: false,
      isDirectory: true,
      name: "Locked",
      createReader: () => ({
        readEntries: (_onEntries, onError) => onError?.(new Error("denied")),
      }),
    };
    const collected = await collectVaultFiles([folder("vault", [broken, file("Kept.md", "x")])]);
    expect(collected.files.map((entry) => entry.path)).toEqual(["Kept.md"]);
    expect(collected.skipped[0]?.path).toBe("Locked");
  });

  it("reports a file that cannot be read", async () => {
    const entry: DroppedEntryLike = {
      isFile: true,
      isDirectory: false,
      name: "Bad.md",
      file: (_onFile, onError) => onError?.(new Error("gone")),
    };
    const collected = await collectVaultFiles([entry]);
    expect(collected.files).toEqual([]);
    expect(collected.skipped[0]?.reason).toContain("gone");
  });
});
