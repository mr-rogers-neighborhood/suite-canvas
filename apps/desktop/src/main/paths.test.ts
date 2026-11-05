import { describe, expect, it } from "vitest";
import { desktopPaths, fileStem, lockFileName } from "./paths.js";

describe("desktopPaths", () => {
  it("puts documents under Documents and state under the data directory", () => {
    const paths = desktopPaths("linux", "/home/me");
    expect(paths.library).toBe("/home/me/Documents/Suite/Canvas");
    // A lock beside a synced document would carry another machine's pid, so
    // locks are never in the library.
    expect(paths.locks.startsWith(paths.data)).toBe(true);
    expect(paths.locks.startsWith(paths.library)).toBe(false);
  });

  it("follows each platform's convention for the data directory", () => {
    expect(desktopPaths("darwin", "/Users/me").data).toBe(
      "/Users/me/Library/Application Support/Suite Canvas",
    );
    expect(desktopPaths("win32", "C:\\Users\\me").data).toContain("AppData");
  });
});

describe("lockFileName", () => {
  it("is a hash, so a path never becomes a file name", () => {
    const name = lockFileName("/home/me/Documents/Suite/Canvas/Research.canvas");
    expect(name).toMatch(/^[0-9a-f]{64}\.json$/u);
    expect(name).not.toContain("Research");
  });

  it("gives different paths different locks", () => {
    expect(lockFileName("/a/x.canvas")).not.toBe(lockFileName("/a/y.canvas"));
  });

  it("is stable for the same path", () => {
    expect(lockFileName("/a/x.canvas")).toBe(lockFileName("/a/x.canvas"));
  });
});

describe("fileStem", () => {
  it("keeps what a filesystem can carry", () => {
    expect(fileStem("Research notes")).toBe("Research notes");
  });

  it("replaces a separator rather than escaping it", () => {
    expect(fileStem("2026/11 plan")).toBe("2026 11 plan");
    expect(fileStem("a:b*c?")).toBe("a b c");
  });

  it("never produces an empty name or a device name", () => {
    expect(fileStem("   ")).toBe("workspace");
    expect(fileStem("///")).toBe("workspace");
    expect(fileStem("CON")).toBe("workspace");
    expect(fileStem("lpt1")).toBe("workspace");
  });

  it("keeps a device name that is only a prefix", () => {
    expect(fileStem("Console notes")).toBe("Console notes");
  });

  it("truncates without leaving a trailing space", () => {
    const stem = fileStem("x".repeat(200));
    expect(stem.length).toBeLessThanOrEqual(80);
    expect(stem.endsWith(" ")).toBe(false);
  });
});
