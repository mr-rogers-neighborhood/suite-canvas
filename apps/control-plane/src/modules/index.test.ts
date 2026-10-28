import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../logging.js";
import { loadModules, MODULE_NAMES } from "./index.js";

const FIXTURES = join(import.meta.dirname, "test-fixtures");

function capture(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  return {
    lines,
    logger: createLogger({ level: "debug", write: (line) => lines.push(line) }),
  };
}

describe("route module loading", () => {
  it("should start with zero modules when the module files are absent", async () => {
    const { lines, logger } = capture();

    const loaded = await loadModules({ logger, directory: FIXTURES });

    expect(MODULE_NAMES).toEqual(["auth", "billing", "admin", "feedback", "settings"]);
    expect(loaded.modules).toEqual([]);
    expect(loaded.status).toEqual([
      { name: "auth", state: "absent" },
      { name: "billing", state: "absent" },
      { name: "admin", state: "absent" },
      { name: "feedback", state: "absent" },
      { name: "settings", state: "absent" },
    ]);
    const absent = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(absent.filter((line) => line.msg === "route module absent")).toHaveLength(5);
  });

  it("should mount a module file that exports the contract", async () => {
    const loaded = await loadModules({
      logger: capture().logger,
      directory: join(FIXTURES, "mounted"),
    });

    expect(loaded.status).toEqual([
      { name: "auth", state: "mounted" },
      { name: "billing", state: "absent" },
      { name: "admin", state: "absent" },
      { name: "feedback", state: "absent" },
      { name: "settings", state: "absent" },
    ]);
    expect(loaded.modules.map((module) => module.name)).toEqual(["auth"]);
    expect(typeof loaded.modules[0]?.handle).toBe("function");
  });

  it("should report a module without a handle as failed, not crash", async () => {
    const { lines, logger } = capture();

    const loaded = await loadModules({ logger, directory: join(FIXTURES, "malformed") });

    expect(loaded.modules).toEqual([]);
    expect(loaded.status[0]).toMatchObject({ name: "auth", state: "failed" });
    expect(loaded.status[0]?.detail).toBeTruthy();
    expect(lines.some((line) => line.includes("route module failed to load"))).toBe(true);
  });

  it("should report a module that throws on import as failed", async () => {
    const loaded = await loadModules({
      logger: capture().logger,
      directory: join(FIXTURES, "throwing"),
    });

    expect(loaded.modules).toEqual([]);
    expect(loaded.status[1]).toMatchObject({ name: "billing", state: "failed" });
    expect(loaded.status[1]?.detail).toContain("fixture refused to import");
  });
});
