import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECENT_LIMIT, recentsStore } from "./recents.js";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "suite-desktop-recents-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("recentsStore", () => {
  it("starts empty", async () => {
    expect(await recentsStore(directory).list()).toEqual([]);
  });

  it("keeps the newest first, with the file's own name", async () => {
    const recents = recentsStore(directory);
    await recents.remember("/home/me/Documents/Suite/Canvas/Research.canvas");
    await recents.remember("/home/me/Documents/Suite/Canvas/Field notes.canvas");
    const list = await recents.list();
    expect(list.map((entry) => entry.name)).toEqual(["Field notes.canvas", "Research.canvas"]);
  });

  it("moves a reopened file to the top rather than listing it twice", async () => {
    const recents = recentsStore(directory);
    await recents.remember("/a.canvas");
    await recents.remember("/b.canvas");
    await recents.remember("/a.canvas");
    const list = await recents.list();
    expect(list).toHaveLength(2);
    expect(list[0]?.path).toBe("/a.canvas");
  });

  it("forgets one file", async () => {
    const recents = recentsStore(directory);
    await recents.remember("/a.canvas");
    await recents.remember("/b.canvas");
    await recents.forget("/a.canvas");
    expect((await recents.list()).map((entry) => entry.path)).toEqual(["/b.canvas"]);
  });

  it("caps the list", async () => {
    const recents = recentsStore(directory);
    for (let index = 0; index < RECENT_LIMIT + 3; index += 1) {
      await recents.remember(`/f${index}.canvas`);
    }
    expect((await recents.list()).length).toBe(RECENT_LIMIT);
  });

  it("treats an unreadable file as empty", async () => {
    await writeFile(join(directory, "recent-files.json"), "nope");
    expect(await recentsStore(directory).list()).toEqual([]);
  });

  it("drops entries that are not records", async () => {
    await writeFile(
      join(directory, "recent-files.json"),
      JSON.stringify([{ path: "/a.canvas", name: "a.canvas", openedAt: 1 }, { path: "/b" }, 3]),
    );
    expect(await recentsStore(directory).list()).toHaveLength(1);
  });
});
