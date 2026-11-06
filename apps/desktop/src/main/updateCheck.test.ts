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

function updater(offered: string | null, fail = false): UpdaterLike {
  return {
    autoDownload: true,
    async checkForUpdates() {
      if (fail) throw new Error("the feed answered 500");
      return offered === null
        ? { updateInfo: { version: "0.9.0" } }
        : { updateInfo: { version: offered } };
    },
  };
}

describe("checkForUpdates", () => {
  it("writes the report the hub reads", async () => {
    const dataDir = await folder();
    const result = await checkForUpdates({
      dataDir,
      version: "0.9.0",
      channel: "alpha",
      packaged: true,
      updater: updater("0.9.0"),
      now,
    });

    expect(result.error).toBeNull();
    const written = JSON.parse(await readFile(join(dataDir, "update-state.json"), "utf8"));
    expect(written).toEqual({
      format: "suite.update-state",
      version: "0.9.0",
      available: "0.9.0",
      checkedAt: "2026-11-06T12:00:00.000Z",
      channel: "alpha",
    });
  });

  it("never downloads unasked", async () => {
    const fake = updater("1.0.0");
    await checkForUpdates({
      dataDir: await folder(),
      version: "0.9.0",
      channel: "stable",
      packaged: true,
      updater: fake,
      now,
    });
    expect(fake.autoDownload).toBe(false);
  });

  it("records the check even when it failed, so the hub can say it tried", async () => {
    const dataDir = await folder();
    const result = await checkForUpdates({
      dataDir,
      version: "0.9.0",
      channel: "stable",
      packaged: true,
      updater: updater(null, true),
      now,
    });

    expect(result.error).toContain("500");
    const written = JSON.parse(await readFile(join(dataDir, "update-state.json"), "utf8"));
    expect(written.checkedAt).toBe("2026-11-06T12:00:00.000Z");
    expect(written.available).toBeNull();
  });

  it("does not ask at all from a checkout, and writes nothing", async () => {
    const dataDir = await folder();
    const result = await checkForUpdates({
      dataDir,
      version: "0.9.0",
      channel: "alpha",
      packaged: false,
      now,
    });

    expect(result.error).toBe("this build has no update feed");
    await expect(readFile(join(dataDir, "update-state.json"), "utf8")).rejects.toThrow();
  });
});
