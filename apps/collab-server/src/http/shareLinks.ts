import type { IncomingMessage, ServerResponse } from "node:http";
import { licenceRequired } from "@suite/licence";
import {
  type CreateShareInput,
  type Share,
  type ShareRole,
  type ShareScope,
  type ShareStore,
  validateShareInput,
} from "../store/shares.js";
import type { WorkspaceAccess } from "./access.js";
import { HttpError } from "./errors.js";
import {
  assertWithinLimit,
  clientAddress,
  shareCreateLimiter,
  shareResolveLimiter,
} from "./rateLimit.js";
import { sendJson } from "./respond.js";
import { clearSessionCookie } from "./shareDraft.js";
import type { ShareRequestHooks } from "./shareHooks.js";
import { flushWorkspace, notify, notifyOpened, notifyRemoved } from "./shareHooks.js";

/**
 * The link CRUD routes: create, list, resolve and revoke. A link token is a
 * capability for one room; minting and revoking one takes a session that is
 * entitled to the workspace. Resolving a link stays public, because the token is
 * the credential the recipient holds.
 */

/**
 * Default lifetime of a new link on the hosted relay. A hosted workspace has a
 * quota and a projection room per link, so a link nobody remembers to revoke
 * should not live forever; 30 days is long enough for a review cycle and short
 * enough that an abandoned link stops being a credential. The account may still
 * pick **Never** (`expiresAt: null` or `0`), and a self-host keeps today's
 * default of no expiry.
 */
export const HOSTED_SHARE_EXPIRY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_ACTIVE_SHARES = (() => {
  const parsed = Number(process.env.SUITE_MAX_SHARES_PER_WORKSPACE ?? 100);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 100;
})();

function parseCreateInput(body: unknown): CreateShareInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw HttpError.badRequest("The request body must be a JSON object.");
  }

  const record = body as Record<string, unknown>;
  const problem = validateShareInput(record);
  if (problem) throw HttpError.badRequest(problem);

  // Every field was narrowed by `validateShareInput`.
  const input: CreateShareInput = {
    workspaceId: (record.workspaceId as string).trim(),
    scope: record.scope as ShareScope,
    role: record.role as ShareRole,
    boardId: (record.boardId as string | null | undefined) ?? null,
    startBoardId: (record.startBoardId as string | null | undefined) ?? null,
    cardId: (record.cardId as string | null | undefined) ?? null,
  };
  // The target's name is read once, to name the page; the link keeps that name
  // even after the card is renamed, so a copied address does not move.
  if (typeof record.name === "string" && record.name.trim().length > 0) {
    input.name = record.name.trim();
  }
  // `undefined` and "never" are different answers: leaving the key out asks the
  // server for its default, while `null` (or `0`) says the link never expires.
  const expiresAt = record.expiresAt;
  if (expiresAt !== undefined) {
    input.expiresAt = expiresAt === 0 ? null : (expiresAt as number | null);
  }
  if (Array.isArray(record.cardIds)) input.cardIds = record.cardIds as readonly string[];
  return input;
}

/**
 * The expiry a new link gets when the caller did not name one. Hosted links last
 * 30 days; a self-host keeps today's no-expiry default. An explicit timestamp,
 * or an explicit null, always wins over this.
 */
export function defaultShareExpiry(now: number = Date.now()): number | null {
  return licenceRequired() ? now + HOSTED_SHARE_EXPIRY_DAYS * DAY_MS : null;
}

export async function createShare(
  request: IncomingMessage,
  store: ShareStore,
  access: WorkspaceAccess,
  response: ServerResponse,
  body: unknown,
  hooks: ShareRequestHooks | undefined,
): Promise<void> {
  const input = parseCreateInput(body);
  await access.forWorkspace(request, input.workspaceId);
  assertWithinLimit(
    shareCreateLimiter,
    input.workspaceId,
    "Too many new share links. Wait a moment and try again.",
  );
  if (store.countActive(input.workspaceId) >= MAX_ACTIVE_SHARES) {
    throw HttpError.conflict(
      `This workspace already has ${MAX_ACTIVE_SHARES} active links. Revoke one before creating another.`,
    );
  }

  // The projection that follows a create reads the saved workspace, so make the
  // account's latest edits part of that save before the share exists.
  await flushWorkspace(hooks, input.workspaceId);
  if (input.expiresAt === undefined) input.expiresAt = defaultShareExpiry();

  const { token, share } = store.create(input);
  sendJson(response, 201, { token, share: publicShare(share) });
  notify(hooks, share.workspaceId);
}

export async function listShares(
  request: IncomingMessage,
  store: ShareStore,
  access: WorkspaceAccess,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  if (workspaceId.length === 0) {
    throw HttpError.badRequest("A workspace id is required.");
  }
  await access.forWorkspace(request, workspaceId);
  sendJson(response, 200, { shares: store.list(workspaceId) });
}

export function resolveShare(
  request: IncomingMessage,
  store: ShareStore,
  response: ServerResponse,
  token: string,
  hooks: ShareRequestHooks | undefined,
): void {
  assertWithinLimit(
    shareResolveLimiter,
    clientAddress(request),
    "Too many link lookups. Wait a moment and try again.",
  );
  const share = store.resolve(token);
  if (!share) throw HttpError.notFound("Share not found.");
  sendJson(response, 200, { share: publicShare(share) });
  notifyOpened(hooks, share);
}

export async function revokeShare(
  request: IncomingMessage,
  store: ShareStore,
  access: WorkspaceAccess,
  response: ServerResponse,
  id: string,
  hooks: ShareRequestHooks | undefined,
): Promise<void> {
  // The id alone does not authenticate: only an account entitled to the share's
  // workspace may revoke it, and the record is read before it is touched.
  const existing = store.get(id);
  if (!existing) throw HttpError.notFound("Share not found.");
  await access.forWorkspace(request, existing.workspaceId);

  const share = store.revoke(id);
  if (!share) throw HttpError.notFound("Share not found.");
  // The store dropped every session of this share; tell this browser to forget
  // its cookie too, so a reload does not present a credential that is gone.
  clearSessionCookie(response);
  sendJson(response, 200, { share: publicShare(share) });
  if (share.revokedAt !== null) {
    notifyRemoved(hooks, share);
    notify(hooks, share.workspaceId);
  }
}

/**
 * Shapes a share for the holder of its link. A board, card or selection viewer
 * must not learn the owner workspace id: with it they could mint a workspace
 * share and escape the projection. The room they can actually open is the
 * projection room, so it stands in; a legacy record without one exposes no id at
 * all. Workspace shares keep the real id because it is already the room the
 * viewer joins. Card ids are dropped for every projection share: the link holder
 * only ever sees what the projection serves, so the id list would leak cards
 * outside the selection. The count stays, because it describes their own link.
 * The slug stays too: it is the page name in the address the holder is reading,
 * and it is not a credential — the token is.
 */
export function publicShare(share: Share): Share {
  if (share.scope === "workspace") return share;
  return { ...share, workspaceId: share.roomId ?? "", cardIds: [] };
}
/** Revokes every active link in a workspace, for incident response. */
export async function revokeAllShares(
  request: IncomingMessage,
  store: ShareStore,
  access: WorkspaceAccess,
  response: ServerResponse,
  url: URL,
  hooks: ShareRequestHooks | undefined,
): Promise<void> {
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  if (workspaceId.length === 0) {
    throw HttpError.badRequest("A workspace id is required.");
  }
  await access.forWorkspace(request, workspaceId);
  const shares = store.revokeAll(workspaceId);
  clearSessionCookie(response);
  sendJson(response, 200, { shares: shares.map(publicShare) });
  for (const share of shares) notifyRemoved(hooks, share);
  notify(hooks, workspaceId);
}
