import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkspaceFileAttachmentInput } from "@suite/graph";
import { createWorkspaceFile, documentAttachments, WorkspaceDocument } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { loadLoroDocument, loroDocumentKey } from "../../projection/index.js";
import type { Share } from "../../store/shares.js";
import { SHARE_ROOM_PREFIX } from "../../store/shares.js";
import { HttpError } from "../errors.js";
import { CORS_HEADERS, sendJson } from "../respond.js";
import type { AdminRequestDeps } from "./deps.js";
import { audit, notifyChanged, readBody } from "./deps.js";
import { claimedOf, loadWorkspace } from "./workspaces.js";

/**
 * Reproduction fixtures and the workspace export: the two routes that write
 * data on an operator's behalf, both bounded by `FIXTURE_CAPS`.
 */

export const FIXTURE_CAPS = {
  boards: 50,
  cards: 2_000,
  sections: 200,
  shares: 20,
} as const;

export function fixtureCount(
  body: Record<string, unknown> | null,
  key: keyof typeof FIXTURE_CAPS,
  fallback: number,
  min: number,
): number {
  const raw = body?.[key];
  if (raw === undefined || raw === null) return fallback;
  const cap = FIXTURE_CAPS[key];
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > cap) {
    throw HttpError.badRequest(`${key} must be a whole number between ${min} and ${cap}.`);
  }
  return raw;
}

/**
 * The fixture workspace id: the caller's, or a fresh one. A `share-` prefix is
 * refused because room names with that prefix are projection rooms, not
 * workspaces, and a fixture must never masquerade as one.
 */
export function fixtureWorkspaceId(body: Record<string, unknown> | null): string {
  const raw = body?.workspaceId;
  if (raw === undefined || raw === null) return `fixture-${randomUUID()}`;
  if (typeof raw !== "string") throw HttpError.badRequest("workspaceId must be a string.");
  const id = raw.trim();
  if (id.length === 0) return `fixture-${randomUUID()}`;
  if (id.length > 512) throw HttpError.badRequest("workspaceId is longer than 512 characters.");
  if (id.startsWith(SHARE_ROOM_PREFIX)) {
    throw HttpError.badRequest(`workspaceId must not start with "${SHARE_ROOM_PREFIX}".`);
  }
  return id;
}

/** Where a fixture link should point: an explicit public URL, else the caller's origin. */
export function publicOrigin(request: IncomingMessage): string {
  const configured = process.env.SUITE_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/u, "");
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin.length > 0) return origin.replace(/\/+$/u, "");
  return "http://localhost:5173";
}

export function fixtureShareUrl(origin: string, token: string): string {
  let url: URL;
  try {
    url = new URL(origin.endsWith("/") ? origin : `${origin}/`);
  } catch {
    // A malformed SUITE_PUBLIC_URL must not fail a fixture call.
    url = new URL("http://localhost:5173/");
  }
  url.searchParams.set("share", token);
  return url.toString();
}

/** Cycles a non-empty list; throws only if a caller broke that invariant. */
export function cycle<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length];
  if (value === undefined) throw new Error("fixture list was empty");
  return value;
}

/**
 * Builds a disposable workspace (or appends to an existing one) through the
 * public `WorkspaceDocument` API, then saves it through the same document store
 * the sync server uses. Everything is created with explicit ids derived from a
 * per-run token, so ids are reproducible within a run and unique across runs.
 */
export async function createFixtures(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminRequestDeps,
  url: URL,
): Promise<void> {
  const body = await readBody(request);
  const workspaceId = fixtureWorkspaceId(body);
  const numberOfBoards = fixtureCount(body, "boards", 1, 1);
  const numberOfCards = fixtureCount(body, "cards", 10, 0);
  const numberOfSections = fixtureCount(body, "sections", 0, 0);
  const numberOfShares = fixtureCount(body, "shares", 0, 0);

  // Claim before seeding: a key that cannot be handed back must fail the call
  // before it leaves half a fixture in the store.
  const claimed = claimedOf(deps, workspaceId);
  let ownerKey: string | null = null;

  const stored = loadLoroDocument(deps.documents, workspaceId);
  const doc = new LoroDoc();
  if (stored) {
    try {
      doc.import(stored);
    } catch {
      throw HttpError.conflict("The stored workspace state could not be read; choose another id.");
    }
  }

  if (!claimed) {
    const claim = deps.workspaces.claimOrVerify;
    if (!claim) throw HttpError.notImplemented("This server cannot claim workspaces.");
    const candidate = randomBytes(32).toString("base64url");
    if (claim(workspaceId, candidate) !== "owner") {
      throw HttpError.conflict("The workspace is already claimed.");
    }
    ownerKey = candidate;
  }

  const workspace = new WorkspaceDocument(doc);
  workspace.ensureDefaultTypes();

  const run = randomUUID().replace(/-/gu, "").slice(0, 12);
  const boardIds: string[] = [];
  for (let index = 0; index < numberOfBoards; index += 1) {
    const id = `fx-${run}-b${index + 1}`;
    workspace.createBoard({ id, name: `Fixture board ${index + 1}` });
    boardIds.push(id);
  }

  const cardIds: string[] = [];
  for (let index = 0; index < numberOfCards; index += 1) {
    const id = `fx-${run}-c${index + 1}`;
    // Row-major grid inside each board: six cards per row, 280px apart.
    const slot = Math.floor(index / numberOfBoards);
    workspace.createCard({
      id,
      boardId: cycle(boardIds, index),
      position: { x: (slot % 6) * 280, y: Math.floor(slot / 6) * 200 },
    });
    cardIds.push(id);
  }

  const sectionIds: string[] = [];
  for (let index = 0; index < numberOfSections; index += 1) {
    const id = `fx-${run}-s${index + 1}`;
    workspace.createSection({
      id,
      boardId: cycle(boardIds, index),
      title: `Fixture section ${index + 1}`,
      x: (index % 4) * 360,
      y: Math.floor(index / 4) * 320,
    });
    sectionIds.push(id);
  }
  if (!workspace.hasSeeded()) workspace.markSeeded();

  const createdShares: FixtureShare[] = [];
  if (numberOfShares > 0) {
    const create = deps.shares.create;
    if (!create) throw HttpError.notImplemented("This server cannot create share links.");
    const origin = publicOrigin(request);
    for (let index = 0; index < numberOfShares; index += 1) {
      // Every third link targets one card, the rest a board; a workspace with
      // no cards still gets board links. All are viewers, as fixtures are for
      // reproduction, not for testing what an editor may publish.
      const input =
        cardIds.length > 0 && index % 3 === 2
          ? {
              workspaceId,
              scope: "card" as const,
              role: "viewer" as const,
              cardId: cycle(cardIds, index),
            }
          : {
              workspaceId,
              scope: "board" as const,
              role: "viewer" as const,
              boardId: cycle(boardIds, index),
            };
      const created = create(input);
      createdShares.push({
        scope: input.scope,
        token: created.token,
        url: fixtureShareUrl(origin, created.token),
      });
    }
  }

  deps.documents.save(loroDocumentKey(workspaceId), workspace.doc.export({ mode: "snapshot" }));
  if (createdShares.length > 0) notifyChanged(deps, workspaceId);

  audit(deps, {
    path: url.pathname,
    target: workspaceId,
    action: "create-fixtures",
    outcome: "created",
    details: {
      seeded: stored !== null,
      boards: boardIds.length,
      cards: cardIds.length,
      sections: sectionIds.length,
      shares: createdShares.length,
    },
  });
  sendJson(response, 200, {
    ok: true,
    workspaceId,
    ownerKey,
    boards: boardIds,
    cards: cardIds,
    sections: sectionIds,
    shares: createdShares,
  });
}

/**
 * Downloads the stored snapshot as the `.suite` envelope the app already reads,
 * so an operator can reproduce a bug locally with the workspace it came from.
 *
 * Images are gathered from the same walker the app's export uses, so an image
 * this box holds ends up in the file byte-for-byte. An id whose bytes are gone
 * is skipped rather than failing the whole export: a partial reprex is still
 * better than none, and the document keeps the node either way.
 */
export function exportWorkspace(
  response: ServerResponse,
  deps: AdminRequestDeps,
  workspaceId: string,
): void {
  const loaded = loadWorkspace(deps.documents, workspaceId);
  if (!loaded) throw HttpError.notFound("Workspace not found.");
  if (!loaded.workspace) {
    throw HttpError.internal("The stored workspace state could not be read.");
  }

  const attachments: Record<string, WorkspaceFileAttachmentInput> = {};
  const store = deps.attachments;
  if (store) {
    for (const node of documentAttachments(loaded.workspace)) {
      const record = store.get(node.id);
      if (!record) continue;
      // The store holds bytes and a mime type, not a filename; the node's own
      // attributes are the only source for the name and dimensions the editor
      // drew, so they win and the store is the fallback for a node without them.
      attachments[node.id] = {
        mime: node.mime ?? record.mime,
        name: node.name ?? "",
        width: node.width,
        height: node.height,
        bytes: record.bytes,
      };
    }
  }

  const { json } = createWorkspaceFile(
    workspaceId,
    loaded.workspace,
    new Date().toISOString(),
    attachments,
  );
  const stem = workspaceId.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 96) || "workspace";
  response.writeHead(200, {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="suite-${stem}.suite"`,
    "content-length": String(Buffer.byteLength(json)),
  });
  response.end(json);
}

/** The Prometheus text body, never cached: a stale scrape is worse than no scrape. */

export interface FixtureShare {
  scope: Share["scope"];
  token: string;
  url: string;
}

/** A fixture count from the body, or a readable 400 when it is out of range. */
