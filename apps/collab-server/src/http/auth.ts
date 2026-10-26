import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Permission } from "loro-protocol";
import { SHARE_ROOM_PREFIX, type ShareStore } from "../store/shares.js";
import type { ConnectionPrincipal, RelaySeatGate } from "../sync/seatGate.js";
import { claimWorkspaceForSession, type WorkspaceClaimDeps } from "./access.js";
import type { SessionVerifier } from "./sessionToken.js";

export interface AuthorizeDeps {
  shares: Pick<ShareStore, "resolve" | "resolveSession" | "hasEditorShare">;
  /**
   * The session verifier (ADR-0074). Absent only on a deployment with no control
   * plane to verify against — and absent means a session join is refused, never
   * downgraded to another credential.
   */
  sessions?: SessionVerifier;
  /**
   * Where a verified session's organization is recorded for the workspace it
   * opens. The join is one of two places the relay learns which organization owns
   * a workspace, because it holds no control-plane database (ADR-0073).
   */
  workspaces?: WorkspaceClaimDeps;
  /** Worker token that may write projection rooms only. */
  projectionToken: string;
  /** Worker token that may write a workspace room only when an editor share exists. */
  sourceToken: string;
  /**
   * The hosted seat gate. Absent on a self-host — and absent means "nothing to
   * enforce", which is the same posture as `licence.ts` being inert without
   * `SUITE_HOSTED=1`. See `seatGate.ts` for what this process can answer.
   */
  seats?: RelaySeatGate;
}

export interface WorkerTokens {
  projectionToken: string;
  sourceToken: string;
}

const decoder = new TextDecoder();
const EPHEMERAL_SUFFIXES = [":presence", ":cursors"] as const;

/**
 * Returns the two scoped worker tokens. They are deliberately separate: the
 * projection token can only touch projection rooms, and the source token can
 * only touch a workspace that currently has an editor share. `SUITE_INTERNAL_TOKEN`
 * is accepted as the projection token for upgrades, never as both.
 */
export function resolveWorkerTokens(env: NodeJS.ProcessEnv = process.env): WorkerTokens {
  const projectionToken =
    env.SUITE_PROJECTION_TOKEN?.trim() || env.SUITE_INTERNAL_TOKEN?.trim() || "";
  const sourceToken = env.SUITE_SOURCE_TOKEN?.trim() || "";

  const projection = projectionToken || randomBytes(32).toString("base64url");
  const source = sourceToken || randomBytes(32).toString("base64url");
  env.SUITE_PROJECTION_TOKEN = projection;
  env.SUITE_SOURCE_TOKEN = source;
  return { projectionToken: projection, sourceToken: source };
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Presence and cursor rooms are derived from the room they describe. */
function baseRoomOf(roomId: string): string {
  for (const suffix of EPHEMERAL_SUFFIXES) {
    if (roomId.length > suffix.length && roomId.endsWith(suffix)) {
      return roomId.slice(0, -suffix.length);
    }
  }
  return roomId;
}

/**
 * Maps the join payload of a sync connection to a room permission.
 *
 * - The projection token may write projection (`share-`) rooms only.
 * - The source token may write a workspace room only when that workspace has an
 *   active editor share; it exists solely for the publish worker.
 * - A share token opens exactly one room: the workspace it shares, or the
 *   `share-<token>` projection room for board and card links. Its derived
 *   presence and cursor rooms need `write` even for a viewer, because they are
 *   ephemeral and scoped to the same share.
 * - An exchanged share session opens exactly the same room with the same role.
 *   The browser presents it instead of the link token, so the permanent
 *   capability never leaves the boot request. Both credentials resolve to the
 *   same `Share`, so a session can never reach a room its share cannot.
 * - A session JWT opens a workspace room and its ephemeral siblings when the
 *   organization it names is the one the relay recorded for that workspace. A
 *   token that fails verification is refused; it is never retried as a share
 *   token or as an anonymous join.
 * - Empty auth is a mismatched credential: a room id alone is not a secret.
 */
export async function authorize(
  roomId: string,
  auth: Uint8Array,
  deps: AuthorizeDeps,
): Promise<Permission | null> {
  const token = decoder.decode(auth ?? new Uint8Array());
  if (token.length === 0) return null;

  /**
   * The credential check decides *what* this connection may do; the seat gate
   * decides *whether it may do it at all* today. They are kept separate so a
   * lapsed entitlement cannot quietly widen a permission, and so the gate is
   * skipped entirely for the internal worker tokens, which are not seats.
   */
  const gated = (
    permission: Permission | null,
    principal: ConnectionPrincipal | null,
  ): Permission | null => {
    if (permission === null) return null;
    if (principal === null || deps.seats === undefined) return permission;
    return deps.seats.allow(principal).ok ? permission : null;
  };

  if (
    deps.projectionToken.length > 0 &&
    constantTimeEqual(token, deps.projectionToken) &&
    baseRoomOf(roomId).startsWith(SHARE_ROOM_PREFIX)
  ) {
    return "write";
  }

  if (deps.sourceToken.length > 0 && constantTimeEqual(token, deps.sourceToken)) {
    const workspaceRoom = baseRoomOf(roomId);
    if (!workspaceRoom.startsWith(SHARE_ROOM_PREFIX) && deps.shares.hasEditorShare(workspaceRoom)) {
      return "write";
    }
    return null;
  }

  const share = deps.shares.resolve(token) ?? deps.shares.resolveSession(token);
  if (share) {
    // A share opens its own room and that room's ephemeral siblings; the seat
    // gate is asked about the workspace the share belongs to, not the room id,
    // because a projection room (`share-<token>`) names no workspace.
    const principal: ConnectionPrincipal = { kind: "share", workspaceId: share.workspaceId };
    if (roomId === share.roomId) {
      return gated(share.role === "editor" ? "write" : "read", principal);
    }
    return baseRoomOf(roomId) === share.roomId ? gated("write", principal) : null;
  }

  const baseRoom = baseRoomOf(roomId);
  // Projection rooms belong to a share, never to a session: opening one with an
  // account would let any session write a projection it holds no link for.
  if (baseRoom.startsWith(SHARE_ROOM_PREFIX)) return null;

  if (deps.sessions === undefined || deps.workspaces === undefined) return null;

  // Verification failure is a refusal. There is no fallback credential here and
  // no "anonymous" answer, so a forged or expired token reaches no room.
  const verified = await deps.sessions.verify(token);
  if (!verified.ok) return null;

  const claims = verified.claims;
  // A workspace belongs to a tenant. A token that names none comes from an
  // account with no organization, and there is nothing for the room to belong
  // to, so it is refused rather than treated as a personal workspace.
  if (claims.organizationId === null) return null;

  const outcome = claimWorkspaceForSession(deps.workspaces, baseRoom, claims);
  if (outcome === "conflict" || outcome === "organization-required") return null;

  return gated("write", {
    kind: "account",
    workspaceId: baseRoom,
    organizationId: claims.organizationId,
    userId: claims.userId,
    role: claims.role,
    tier: claims.tier,
    limits: claims.limits,
  });
}
