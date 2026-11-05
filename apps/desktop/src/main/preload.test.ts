import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IPC } from "../shared/ipc.js";

/**
 * The preload cannot import the shared constants — a sandboxed preload has no
 * ESM and only a handful of built-ins — so its channel names are spelled out.
 * This is what stops them drifting: a rename in `shared/ipc.ts` fails here
 * rather than at runtime, where the symptom is a bridge method that never
 * returns.
 */
const here = dirname(fileURLToPath(import.meta.url));
const preload = readFileSync(join(here, "..", "preload", "index.cjs"), "utf8");

describe("the preload bridge", () => {
  it.each(Object.entries(IPC))(
    "names the %s channel exactly as shared/ipc.ts does",
    (_name, channel) => {
      expect(preload).toContain(`"${channel}"`);
    },
  );

  it("exposes the one global the renderer looks for", () => {
    expect(preload).toContain('exposeInMainWorld("suiteDesktop"');
  });

  it("claims to be the desktop host", () => {
    expect(preload).toContain('host: "desktop"');
  });

  it("does not take a path from the renderer", () => {
    // The page says what to save, never where: there is no channel that would
    // let a document steer a write.
    expect(preload).not.toMatch(/saveAs|openPath|writeFile|readFile/u);
  });
});
