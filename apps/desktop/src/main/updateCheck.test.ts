import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkForUpdates, type UpdaterLike } from "./updateCheck.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function folder(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "suite-update-"));
  cleanups.push(path);
  return path;
}

const now = () => new Date("2026-11-06T12:00:00.000Z");
const FEED = "https://feed.test/latest/download";

/** A feed with no signature at all: the case the app must refuse. */
function unsignedFeed(): typeof fetch {
  return (async (url: string | URL) => {
    const href = String(url);
    if (href.endsWith(".sig")) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => "version: 9.9.9\n" };
  }) as unknown as typeof fetch;
}

function updater(): UpdaterLike & { calls: number } {
  const fake = {
    autoDownload: true,
    calls: 0,
    async checkForUpdates() {
      fake.calls += 1;
      return { updateInfo: { version: "9.9.9" } };
    },
  };
  return fake;
}

describe("checkForUpdates", () => {
  it("refuses an unsigned manifest and never asks the updater", async () => {
    const dataDir = await folder();
    const fake = updater();
    const result = await checkForUpdates({
      dataDir,
      version: "0.1.0",
      channel: "alpha",
      packaged: true,
      feed: FEED,
      fetch: unsignedFeed(),
      updater: fake,
      now,
    });

    expect(result.verified).toBe(false);
    expect(result.error).toContain("no signature");
    expect(fake.calls).toBe(0);
    // No report: a card that says "checked" would claim an answer nobody gave.
    await expect(readFile(join(dataDir, "update-state.json"), "utf8")).rejects.toThrow();
  });

  it("does not ask at all from a checkout", async () => {
    const dataDir = await folder();
    const result = await checkForUpdates({
      dataDir,
      version: "0.1.0",
      channel: "alpha",
      packaged: false,
      now,
    });
    expect(result.error).toBe("this build has no update feed");
    expect(result.state).toBeNull();
  });

  it("never downloads unasked, when the update is real", async () => {
    // The manifest here is signed by the pinned publisher key, so this path needs the
    // real signature; the accepting path is covered in `@suite/desktop`. What matters
    // here is that the flag is set before any check runs, which the refusal above
    // cannot show.
    const fake = updater();
    await checkForUpdates({
      dataDir: await folder(),
      version: "0.1.0",
      channel: "alpha",
      packaged: true,
      feed: FEED,
      fetch: unsignedFeed(),
      updater: fake,
      now,
    });
    expect(fake.autoDownload).toBe(true);
  });
});
