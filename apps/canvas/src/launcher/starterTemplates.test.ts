import { STARTER_TEMPLATES, type WorkspaceTemplate, workspaceTemplateSchema } from "@suite/graph";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHOSEN_TEMPLATE_KEY,
  cacheStarterTemplates,
  DEFAULT_STARTER_TEMPLATE_ID,
  fetchStarterTemplates,
  loadStarterTemplates,
  readCachedStarterTemplates,
  rememberChosenTemplate,
  STARTER_TEMPLATES_CACHE_KEY,
  starterTemplateById,
  TEMPLATES_PATH,
  takeChosenTemplate,
} from "./starterTemplates";

/**
 * A starter as the server describes it: row metadata around the authored data.
 * The data has no id of its own here on purpose — the row is what names it.
 */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "from-server",
    name: "From the server",
    description: "A starter the bundle has never seen",
    version: 2,
    data: { boards: [{ name: "Fetched", sections: [] }] },
    ...overrides,
  };
}

function answer(body: unknown, status = 200): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
}

function recordingFetch(body: unknown) {
  const seen: string[] = [];
  const call = (async (url: string) => {
    seen.push(url);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { call, seen };
}

function authored(id: string): WorkspaceTemplate {
  return workspaceTemplateSchema.parse({
    id,
    name: `Authored ${id}`,
    description: "Written by a test",
    version: 1,
    boards: [{ name: "Board", sections: [] }],
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe("the starter template cache", () => {
  it("answers from the cache at once, and refreshes it in the background", async () => {
    const cached = [authored("cached")];
    cacheStarterTemplates(cached);
    const { call, seen } = recordingFetch({ ok: true, templates: [row()] });

    const templates = await loadStarterTemplates({ fetch: call });

    expect(templates.map((template) => template.id)).toEqual(["cached"]);
    // The refresh is deliberately not awaited, so the first paint never waits on
    // the network; the visit after this one reads the new list.
    await vi.waitFor(() => expect(seen).toHaveLength(1));
  });

  it("fetches the public list, turns rows back into templates and keeps them", async () => {
    const { call, seen } = recordingFetch({ ok: true, templates: [row()] });

    const templates = await loadStarterTemplates({ base: "https://suite.test", fetch: call });

    expect(seen).toEqual([`https://suite.test${TEMPLATES_PATH}`]);
    // The server's template leads; the built-ins are still there, because Notebook
    // is the default shape and a deployment must not lose it by adding one.
    expect(templates[0]?.id).toBe("from-server");
    expect(templates[0]?.name).toBe("From the server");
    expect(templates[0]?.version).toBe(2);
    expect(templates[0]?.boards[0]?.name).toBe("Fetched");
    expect(templates.map((template) => template.id)).toEqual([
      "from-server",
      ...STARTER_TEMPLATES.map((template) => template.id).filter((id) => id !== "from-server"),
    ]);
    expect(readCachedStarterTemplates()?.map((template) => template.id)).toEqual(
      templates.map((template) => template.id),
    );
  });

  it("prefers the row's name, so a rename in the admin panel is what the select shows", async () => {
    const { call } = recordingFetch({
      ok: true,
      templates: [
        row({
          name: "Renamed",
          description: "Renamed too",
          data: {
            id: "from-server",
            name: "Old",
            description: "Old",
            boards: [{ name: "Fetched", sections: [] }],
          },
        }),
      ],
    });

    const templates = await fetchStarterTemplates({ fetch: call });

    expect(templates?.[0]?.name).toBe("Renamed");
    expect(templates?.[0]?.description).toBe("Renamed too");
  });

  it("falls back to the built-in starters when the request fails", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;

    expect(await loadStarterTemplates({ fetch: failing })).toBe(STARTER_TEMPLATES);
  });

  it("falls back when the server answers with something that is not a list", async () => {
    const ids = (templates: readonly WorkspaceTemplate[]) =>
      templates.map((template) => template.id);
    expect(ids(await loadStarterTemplates({ fetch: answer({ ok: true }) }))).toEqual(
      ids(STARTER_TEMPLATES),
    );
    expect(
      ids(await loadStarterTemplates({ fetch: answer({ ok: true, templates: [1, 2] }) })),
    ).toEqual(ids(STARTER_TEMPLATES));
    expect(ids(await loadStarterTemplates({ fetch: answer({ ok: false }, 500) }))).toEqual(
      ids(STARTER_TEMPLATES),
    );
  });

  /**
   * An empty list is an answer. Otherwise the last template an operator deleted
   * would sit in this browser forever, because "nothing served" was read as
   * "nothing heard".
   */
  it("treats an empty server list as an answer, so a deletion lands", async () => {
    const templates = await loadStarterTemplates({ fetch: answer({ ok: true, templates: [] }) });

    expect(templates.map((template) => template.id)).toEqual(
      STARTER_TEMPLATES.map((template) => template.id),
    );
    expect(readCachedStarterTemplates()?.map((template) => template.id)).toEqual(
      STARTER_TEMPLATES.map((template) => template.id),
    );
  });

  it("gives up on a server that never answers", async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof globalThis.fetch;

    expect(await loadStarterTemplates({ fetch: hanging, timeoutMs: 5 })).toBe(STARTER_TEMPLATES);
  });

  it("never asks in a standalone build, which has no server to ask", async () => {
    vi.stubEnv("VITE_SUITE_MODE", "standalone");
    const { call, seen } = recordingFetch({ ok: true, templates: [row()] });

    expect(await loadStarterTemplates({ base: "https://suite.test" })).toBe(STARTER_TEMPLATES);
    // The injected fetch is the exception the check is for: a test saying it knows
    // better than the build profile.
    expect(await loadStarterTemplates({ fetch: call })).not.toBe(STARTER_TEMPLATES);
    expect(seen).toHaveLength(1);
  });

  it("discards a cached payload it cannot read, so the next launch can replace it", async () => {
    window.localStorage.setItem(STARTER_TEMPLATES_CACHE_KEY, "{not json");
    expect(readCachedStarterTemplates()).toBeNull();
    expect(window.localStorage.getItem(STARTER_TEMPLATES_CACHE_KEY)).toBeNull();

    window.localStorage.setItem(STARTER_TEMPLATES_CACHE_KEY, JSON.stringify([{ id: "x" }]));
    expect(readCachedStarterTemplates()).toBeNull();
    expect(window.localStorage.getItem(STARTER_TEMPLATES_CACHE_KEY)).toBeNull();

    window.localStorage.setItem(STARTER_TEMPLATES_CACHE_KEY, JSON.stringify([]));
    expect(readCachedStarterTemplates()).toBeNull();
  });
});

describe("the template the launcher hands to the boot", () => {
  it("survives the trip as an object, which is what applyWorkspaceTemplate accepts", () => {
    const template = authored("from-server");
    rememberChosenTemplate("ws-1", template);

    expect(takeChosenTemplate("ws-1")).toEqual(template);
  });

  it("belongs to one workspace, and is taken once", () => {
    rememberChosenTemplate("ws-1", authored("from-server"));

    expect(takeChosenTemplate("ws-2")).toBeNull();
    expect(takeChosenTemplate("ws-1")).not.toBeNull();
    expect(takeChosenTemplate("ws-1")).toBeNull();
  });

  it("is dropped when it cannot be read back", () => {
    window.localStorage.setItem(CHOSEN_TEMPLATE_KEY, '{"workspaceId":"ws-1","template":42}');

    expect(takeChosenTemplate("ws-1")).toBeNull();
    expect(window.localStorage.getItem(CHOSEN_TEMPLATE_KEY)).toBeNull();
  });
});

describe("the select's own data", () => {
  it("preselects the notebook, which the built-in starters carry", () => {
    expect(DEFAULT_STARTER_TEMPLATE_ID).toBe("notebook");
    expect(starterTemplateById(STARTER_TEMPLATES, DEFAULT_STARTER_TEMPLATE_ID)?.name).toBe(
      "Notebook",
    );
  });

  it("has no template for an id nobody carries", () => {
    expect(starterTemplateById(STARTER_TEMPLATES, "nope")).toBeUndefined();
  });
});
