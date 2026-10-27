import { applyWorkspaceTemplate, TEMPLATE_ASSET_MAX_BYTES, WorkspaceDocument } from "@suite/graph";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttachmentSource } from "../session/attachmentBytes";
import { saveWorkspaceTemplate, templateIdFromName, templateSavedNotice } from "./captureClient";
import { OPERATOR_TOKEN_KEY } from "./operatorToken";

/**
 * The picture capture is a client because the bytes are here, so these tests ask
 * the two questions that matter to a person: did the picture reach the template,
 * and when it did not, does the message say why.
 */

const TOKEN = "operator-token";
const BASE = "https://control.test";

/** A 1×1 PNG, as the template data a seeded board carries. */
const SEED_PICTURE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x80, 0x00, 0xc3,
]);

interface Seeded {
  workspace: WorkspaceDocument;
  /** The id each picture lives under in this browser, as the document names it. */
  attachmentIds: string[];
}

/**
 * A workspace with one board and `pictures` cards, each showing a picture.
 *
 * Built by applying a template rather than by hand: that is the same typed path
 * the canvas writes, so the fixture cannot drift from what a real board holds.
 */
function seededWorkspace(pictures: number): Seeded {
  const workspace = new WorkspaceDocument();
  const assets = Array.from({ length: pictures }, (_, index) => ({
    key: `seed-${index + 1}`,
    mime: "image/png",
    data: SEED_PICTURE,
    name: `picture-${index + 1}.png`,
  }));
  const applied = applyWorkspaceTemplate(workspace, {
    id: "seed",
    name: "Seed",
    description: "A workspace holding pictures",
    version: 1,
    assets,
    boards: [
      {
        name: "Research",
        sections: [],
        cards: assets.map((asset, index) => ({
          title: `Card ${index + 1}`,
          x: index * 40,
          y: 0,
          asset: asset.key,
        })),
      },
    ],
  });
  return {
    workspace,
    attachmentIds: (applied?.assets ?? []).map((entry) => entry.attachmentId),
  };
}

/** A store that answers for the ids it was given, and records every question. */
function store(bytesById: Map<string, Uint8Array>): {
  source: AttachmentSource;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    source: {
      name: "test",
      read: async (id) => {
        asked.push(id);
        const bytes = bytesById.get(id);
        return bytes === undefined ? null : { bytes, mime: "image/png" };
      },
    },
  };
}

function bytesFor(ids: readonly string[], size?: number): Map<string, Uint8Array> {
  return new Map(
    ids.map((id) => [id, size === undefined ? new Uint8Array(PNG_BYTES) : new Uint8Array(size)]),
  );
}

interface Posted {
  url: string;
  init: RequestInit;
}

function responder(
  status: number,
  body: unknown,
): { fetch: typeof globalThis.fetch; posted: Posted[] } {
  const posted: Posted[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    posted.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, posted };
}

/** The body the client sent, as the record the control plane would read. */
function postedBody(posted: Posted[]): Record<string, unknown> {
  const body = posted[0]?.init.body;
  if (typeof body !== "string") throw new Error("no JSON body was posted");
  return JSON.parse(body) as Record<string, unknown>;
}

afterEach(() => {
  window.sessionStorage.clear();
});

describe("templateIdFromName", () => {
  it("hyphenates and lowercases, so an id is a word an operator recognises", () => {
    expect(templateIdFromName("Research Board")).toBe("research-board");
    expect(templateIdFromName("  Weekly Review — Q3  ")).toBe("weekly-review-q3");
    expect(templateIdFromName("Café notes")).toBe("cafe-notes");
  });

  it("still produces an id for a name with nothing to slug", () => {
    expect(templateIdFromName("…")).toBe("captured-template");
  });
});

describe("saveWorkspaceTemplate", () => {
  it("captures every board, region and picture and posts it with the token", async () => {
    const { workspace, attachmentIds } = seededWorkspace(2);
    const { source, asked } = store(bytesFor(attachmentIds));
    const { fetch, posted } = responder(200, { ok: true, template: { id: "research-board" } });

    const outcome = await saveWorkspaceTemplate({
      workspace,
      name: "Research Board",
      description: "Questions, sources and findings",
      token: TOKEN,
      base: BASE,
      fetch,
      sources: [source],
    });

    expect(outcome).toMatchObject({
      ok: true,
      id: "research-board",
      name: "Research Board",
      assets: 2,
      dropped: 0,
    });
    if (outcome.ok) {
      expect(templateSavedNotice(outcome)).toBe(
        "“Research Board” is saved as a starter template with 2 pictures. New workspaces can start from it.",
      );
    }

    // One request, to the operator route, carrying the token it was given.
    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toBe(`${BASE}/admin/templates`);
    expect(posted[0]?.init.method).toBe("POST");
    const headers = new Headers(posted[0]?.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("content-type")).toBe("application/json");

    // The body is the shape the control plane reads: id, name, description, and
    // the template itself as `data`, pictures inline.
    const body = postedBody(posted);
    expect(body).toMatchObject({
      id: "research-board",
      name: "Research Board",
      description: "Questions, sources and findings",
      version: 1,
    });
    const data = body.data as {
      boards: Array<{ name: string; cards: Array<{ asset?: string; title: string }> }>;
      assets: Array<{ key: string; mime: string; data: string }>;
    };
    expect(data.boards[0]?.name).toBe("Research");
    expect(data.boards[0]?.cards.map((card) => card.title)).toEqual(["Card 1", "Card 2"]);
    expect(data.boards[0]?.cards.every((card) => card.asset !== undefined)).toBe(true);
    expect(data.assets).toHaveLength(2);
    expect(data.assets[0]?.mime).toBe("image/png");

    // Exactly the bytes the store handed over, base64 rather than re-encoded.
    const decoded = Uint8Array.from(atob(data.assets[0]?.data ?? ""), (character) =>
      character.charCodeAt(0),
    );
    expect(Array.from(decoded)).toEqual(Array.from(PNG_BYTES));

    // And the loader asked once per picture, by the id the document names.
    expect(asked).toEqual(attachmentIds);
  });

  it("asks the store once for each picture, and no more", async () => {
    const { workspace, attachmentIds } = seededWorkspace(3);
    const { source, asked } = store(bytesFor(attachmentIds));
    const { fetch } = responder(200, { ok: true, template: {} });

    await saveWorkspaceTemplate({
      workspace,
      name: "Three pictures",
      token: TOKEN,
      base: BASE,
      fetch,
      sources: [source],
    });

    expect(asked).toHaveLength(3);
    expect(new Set(asked)).toEqual(new Set(attachmentIds));
  });

  it("says the operator token is missing rather than that the upload failed", async () => {
    const { workspace, attachmentIds } = seededWorkspace(1);
    const { source, asked } = store(bytesFor(attachmentIds));
    const { fetch, posted } = responder(200, { ok: true });

    const outcome = await saveWorkspaceTemplate({
      workspace,
      name: "Research",
      token: null,
      base: BASE,
      fetch,
      sources: [source],
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("no-token");
      expect(outcome.message).toMatch(/operator token/u);
      expect(outcome.message).toMatch(/operator panel/u);
    }
    // Nothing was read and nothing was sent: the token is checked first.
    expect(asked).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("reads the token this tab holds when none is passed", async () => {
    window.sessionStorage.setItem(OPERATOR_TOKEN_KEY, TOKEN);
    const { workspace, attachmentIds } = seededWorkspace(1);
    const { source } = store(bytesFor(attachmentIds));
    const { fetch, posted } = responder(200, { ok: true });

    const outcome = await saveWorkspaceTemplate({
      workspace,
      name: "Research",
      base: BASE,
      fetch,
      sources: [source],
    });

    expect(outcome.ok).toBe(true);
    expect(new Headers(posted[0]?.init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("says the id is taken when the control plane answers 409", async () => {
    const { workspace, attachmentIds } = seededWorkspace(1);
    const { source } = store(bytesFor(attachmentIds));
    const { fetch } = responder(409, {
      ok: false,
      error: "template-exists",
      message: 'a template with id "research" already exists; PUT it to replace it',
    });

    const outcome = await saveWorkspaceTemplate({
      workspace,
      name: "Research",
      token: TOKEN,
      base: BASE,
      fetch,
      sources: [source],
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("duplicate");
      expect(outcome.message).toMatch(/“research”/u);
      expect(outcome.message).toMatch(/already exists/u);
      expect(outcome.message).toMatch(/operator panel/u);
    }
  });

  it("carries the cards but leaves out a picture that is too heavy to carry", async () => {
    const { workspace, attachmentIds } = seededWorkspace(2);
    const oversized = new Map<string, Uint8Array>([
      [attachmentIds[0] ?? "", new Uint8Array(TEMPLATE_ASSET_MAX_BYTES + 1)],
      [attachmentIds[1] ?? "", new Uint8Array(PNG_BYTES)],
    ]);
    const { source } = store(oversized);
    const { fetch, posted } = responder(200, { ok: true });

    const outcome = await saveWorkspaceTemplate({
      workspace,
      name: "Heavy",
      token: TOKEN,
      base: BASE,
      fetch,
      sources: [source],
    });

    expect(outcome).toMatchObject({ ok: true, assets: 1, dropped: 1 });
    if (outcome.ok) {
      expect(templateSavedNotice(outcome)).toMatch(/1 picture was too heavy/u);
    }
    const data = postedBody(posted).data as { assets: unknown[]; boards: unknown[] };
    expect(data.assets).toHaveLength(1);
    // The card whose picture was dropped is still in the template.
    expect(data.boards).toHaveLength(1);
  });

  it("refuses a template over the body cap before it uploads anything", async () => {
    const { workspace, attachmentIds } = seededWorkspace(2);
    const { source } = store(bytesFor(attachmentIds));
    const { fetch, posted } = responder(200, { ok: true });

    const outcome = await saveWorkspaceTemplate({
      workspace,
      name: "Research",
      token: TOKEN,
      base: BASE,
      fetch,
      sources: [source],
      maxBodyBytes: 64,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("too-large");
      expect(outcome.message).toMatch(/MB/u);
      expect(outcome.message).toMatch(/fewer pictures|smaller/u);
    }
    expect(posted).toEqual([]);
  });

  it("surfaces the graph's own words on an empty workspace", async () => {
    const { fetch, posted } = responder(200, { ok: true });

    const outcome = await saveWorkspaceTemplate({
      workspace: new WorkspaceDocument(),
      name: "Empty",
      token: TOKEN,
      base: BASE,
      fetch,
      sources: [],
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("cannot-capture");
      expect(outcome.message).toMatch(/empty workspace/u);
    }
    expect(posted).toEqual([]);
  });

  it("reports a refused status with the server's own message", async () => {
    const { workspace, attachmentIds } = seededWorkspace(1);
    const { source } = store(bytesFor(attachmentIds));
    const { fetch } = responder(400, {
      ok: false,
      error: "invalid-request",
      message: "data is required and has to be a JSON object",
    });

    const outcome = await saveWorkspaceTemplate({
      workspace,
      name: "Research",
      token: TOKEN,
      base: BASE,
      fetch,
      sources: [source],
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("rejected");
      expect(outcome.message).toContain("data is required");
    }
  });

  it("says the control plane could not be reached", async () => {
    const { workspace, attachmentIds } = seededWorkspace(1);
    const { source } = store(bytesFor(attachmentIds));
    const unreachable = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof globalThis.fetch;

    const outcome = await saveWorkspaceTemplate({
      workspace,
      name: "Research",
      token: TOKEN,
      base: BASE,
      fetch: unreachable,
      sources: [source],
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("unreachable");
      expect(outcome.message).toContain(BASE);
    }
  });

  it("does not start a second capture while one is running", async () => {
    const { workspace, attachmentIds } = seededWorkspace(1);
    const { source } = store(bytesFor(attachmentIds));
    // A holder rather than a `let`: the assignment happens inside the promise's
    // executor, which the narrowing of a plain local cannot see.
    const control: { release?: () => void } = {};
    const pending = new Promise<void>((resolve) => {
      control.release = resolve;
    });
    const fetch = (async () => {
      await pending;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const first = saveWorkspaceTemplate({
      workspace,
      name: "Research",
      token: TOKEN,
      base: BASE,
      fetch,
      sources: [source],
    });
    const second = await saveWorkspaceTemplate({
      workspace,
      name: "Research",
      token: TOKEN,
      base: BASE,
      fetch,
      sources: [source],
    });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("busy");

    control.release?.();
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it("refuses in a browser-only build, which has no control plane at all", async () => {
    vi.stubEnv("VITE_SUITE_MODE", "standalone");
    const { workspace, attachmentIds } = seededWorkspace(1);
    const { source, asked } = store(bytesFor(attachmentIds));
    const { fetch, posted } = responder(200, { ok: true });
    try {
      const outcome = await saveWorkspaceTemplate({
        workspace,
        name: "Research",
        token: TOKEN,
        base: BASE,
        fetch,
        sources: [source],
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toBe("standalone");
        expect(outcome.message).toMatch(/no server/u);
      }
      expect(asked).toEqual([]);
      expect(posted).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses a blank name without touching the workspace", async () => {
    const { fetch, posted } = responder(200, { ok: true });
    const outcome = await saveWorkspaceTemplate({
      workspace: new WorkspaceDocument(),
      name: "   ",
      token: TOKEN,
      base: BASE,
      fetch,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("no-name");
    expect(posted).toEqual([]);
  });
});
