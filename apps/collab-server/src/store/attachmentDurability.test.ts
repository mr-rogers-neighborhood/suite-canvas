import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateConfig } from "../config/config.js";
import {
  attachmentDatabasePath,
  createSqliteAttachmentStore,
  defaultAttachmentStore,
  resetDefaultAttachmentStore,
} from "./attachments.js";

/**
 * A1 is a deployment fact, not a unit-test fact: the bytes are lost because the
 * container's attachment store is not on the volume. These tests hold both ends
 * down — the compose file names a durable path for all six stores, and a
 * store reopened from that file returns the exact bytes it was given.
 */

const ROOT = new URL("../../../../", import.meta.url);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7, 7]);

function repoFile(name: string): string {
  return readFileSync(new URL(name, ROOT), "utf8");
}

/**
 * The `environment:` mapping of the `app` service, as compose would hand it to
 * the process with every `SUITE_*` variable unset. Parsed by hand because the
 * repo has no YAML dependency and the block is flat `KEY: value` lines.
 */
function composedEnvironment(): Record<string, string> {
  const lines = repoFile("compose.yaml").split("\n");
  const start = lines.findIndex((line) => /^\s+environment:\s*$/u.test(line));
  expect(start).toBeGreaterThan(-1);
  const entries: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\s{0,4}\S/u.test(line)) break; // dedented to the next service key
    const match = /^\s+([A-Z0-9_]+):\s*(.*)$/u.exec(line);
    if (match?.[1] !== undefined) entries[match[1]] = (match[2] ?? "").trim();
  }
  return entries;
}

/** `${SUITE_X:-default}` with the variable unset, as compose resolves it. */
function defaultValue(raw: string): string {
  const fallback = /^\$\{[A-Z0-9_]+:-(.*)\}$/u.exec(raw);
  return fallback?.[1] ?? raw;
}

const STORES = [
  ["SUITE_DB", "documents"],
  ["SUITE_SHARES_DB", "shares"],
  ["SUITE_WORKSPACES_DB", "workspaces"],
  ["SUITE_SETTINGS_DB", "settings"],
  ["SUITE_LICENCE_DB", "licences"],
  ["SUITE_ATTACHMENTS_DB", "attachments"],
] as const;

describe("the composed deployment keeps all six stores", () => {
  it("points every store at a file on the suite-data volume", () => {
    const environment = composedEnvironment();
    expect(repoFile("compose.yaml")).toMatch(/suite-data:\/data/u);
    for (const [variable, name] of STORES) {
      const raw = environment[variable];
      expect(raw, `${variable} is missing from compose.yaml`).toBeTypeOf("string");
      expect(defaultValue(raw ?? "")).toBe(`/data/${name}.sqlite`);
    }
  });

  it("gives the server a configuration it accepts at boot", () => {
    const environment = composedEnvironment();
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      PORT: "1234",
      HEALTH_PORT: "1235",
      SUITE_HOSTED: "0",
      SUITE_LOG_LEVEL: "info",
      SUITE_TRUST_PROXY: "0",
    };
    for (const [variable] of STORES) env[variable] = defaultValue(environment[variable] ?? "");
    // `/data` does not exist on this host, and that is the point: boot
    // validation accepts a path the store will create at first write.
    const result = validateConfig(env);
    const storeVariables = new Set<string>(STORES.map(([variable]) => variable));
    const storeProblems = result.problems.filter((problem) => storeVariables.has(problem.variable));
    expect(storeProblems).toEqual([]);
    expect(result.config.paths.attachments).toBe("/data/attachments.sqlite");
    expect(result.config.paths.settings).toBe("/data/settings.sqlite");
    expect(result.config.paths.licences).toBe("/data/licences.sqlite");
  });

  it("documents all six stores, with no store left implied", () => {
    const example = repoFile(".env.example");
    for (const [variable, name] of STORES) {
      expect(example, `${variable} is not documented in .env.example`).toContain(
        `# ${variable}=/data/${name}.sqlite`,
      );
    }
    expect(example).not.toContain("Reserved for attachments");
  });
});

describe("attachment bytes survive a restart", () => {
  const created: string[] = [];

  afterEach(() => {
    resetDefaultAttachmentStore();
    delete process.env.SUITE_ATTACHMENTS_DB;
    for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function scratch(): string {
    const directory = mkdtempSync(join(import.meta.dirname, ".attachments-test-"));
    created.push(directory);
    return directory;
  }

  it("reads the path from SUITE_ATTACHMENTS_DB", () => {
    expect(attachmentDatabasePath({})).toBe("suite.attachments.sqlite");
    expect(attachmentDatabasePath({ SUITE_ATTACHMENTS_DB: " /data/attachments.sqlite " })).toBe(
      "/data/attachments.sqlite",
    );
  });

  it("reopens the file and returns byte-identical bytes", () => {
    const path = join(scratch(), "attachments.sqlite");
    process.env.SUITE_ATTACHMENTS_DB = path;

    const first = defaultAttachmentStore();
    const meta = first.put("ws-restart", PNG, "image/png");
    expect(meta.size).toBe(PNG.byteLength);
    resetDefaultAttachmentStore();

    // A new process opens the same file: this is what `docker compose up
    // --force-recreate` does, minus the container.
    const second = defaultAttachmentStore();
    const restored = second.get(meta.id);
    expect(restored).not.toBeNull();
    expect(new Uint8Array(restored?.bytes ?? new Uint8Array())).toEqual(PNG);
    expect(restored?.mime).toBe("image/png");
    expect(second.usage("ws-restart")).toBe(PNG.byteLength);
  });

  it("keeps the bytes across two independent connections to one file", () => {
    const path = join(scratch(), "attachments.sqlite");
    const writer = createSqliteAttachmentStore(path);
    const meta = writer.put("ws-a", PNG, "image/png");
    writer.close();

    const reader = createSqliteAttachmentStore(path);
    try {
      expect(new Uint8Array(reader.get(meta.id)?.bytes ?? new Uint8Array())).toEqual(PNG);
    } finally {
      reader.close();
    }
  });
});
