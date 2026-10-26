import { capabilitiesForRole } from "./capabilities.js";
import { AuthError } from "./errors.js";
import { generateInviteKey, hashInviteKey, looksLikeInviteKey } from "./keys.js";
import type { InviteKeyRecord, InviteKeyRole, MemberRecord, OrganizationRole } from "./types.js";
import { isInviteKeyRole } from "./types.js";
import { memberOf, type WorkspaceRepository } from "./workspaces.js";

/**
 * Invite keys: the invitation that survives being forwarded (ADR-0065 §3,
 * amendment §6).
 *
 * A key is a row, not a signed token, for one reason: revocation must be an
 * update, and a revocation list is a row — so the row is the primitive. The
 * other half of the design is where the key's *effects* land: redeeming one
 * inserts an organization `member` row and nothing else. It cannot touch a
 * document because this service has no document access at all.
 *
 * The plaintext key exists only in the response to its creator. The database
 * stores a SHA-256 hash, exactly like the owner key and the share tokens.
 */

/** Longest expiry we accept, so a typo cannot mint a key for the year 3000. */
export const MAX_INVITE_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;
/** Largest use count accepted; it only exists to bound a spreadsheet-ish mistake. */
export const MAX_INVITE_USES = 1000;

/**
 * The row as stored, hash included. Never handed to a route.
 *
 * `organizationId` is duplicated from the workspace on purpose: redeeming the key
 * inserts an organization `member` row, and the invitation names its tenant at
 * mint time rather than relying on a join that could be re-pointed later.
 */
export interface StoredInviteKey extends InviteKeyRecord {
  organizationId: string;
  keyHash: string;
}

/**
 * Storage for `invite_keys` plus the one write it shares with Better Auth's
 * `member` table.
 *
 * `claimAndAddMember` is the interesting method and its contract is strict: the
 * conditional counter update and the member insert happen in **one
 * transaction**, and a zero-row update means the key is spent. The Postgres
 * implementation is `redeem_invite_key` in `sql/0001_control_plane.sql`.
 */
export interface InviteKeyRepository {
  create: (input: {
    id: string;
    workspaceId: string;
    organizationId: string;
    keyHash: string;
    role: InviteKeyRole;
    createdByUserId: string;
    expiresAt: number | null;
    maxUses: number;
    createdAt: number;
  }) => Promise<StoredInviteKey>;
  findByHash: (keyHash: string) => Promise<StoredInviteKey | null>;
  /**
   * Atomically spends one use and adds the member. Returns null when the
   * conditional update matched no row — revoked, exhausted, or revoked between
   * the caller's read and this statement. There is no partial outcome: either
   * both the counter and the member row are committed, or neither is.
   */
  claimAndAddMember: (input: {
    keyId: string;
    workspaceId: string;
    userId: string;
    role: InviteKeyRole;
    now: number;
  }) => Promise<{ key: StoredInviteKey; member: MemberRecord } | null>;
  revoke: (input: { keyId: string; now: number }) => Promise<StoredInviteKey | null>;
  listForWorkspace: (workspaceId: string) => Promise<StoredInviteKey[]>;
}

export interface CreateInviteKeyInput {
  workspaceId: string;
  /** Only admin or member: an invite cannot hand over ownership. */
  role: InviteKeyRole;
  createdByUserId: string;
  /** Role of the person creating the key; only a link manager may mint one. */
  actorRole: OrganizationRole;
  /** Epoch milliseconds, or null for a key that does not expire. */
  expiresAt: number | null;
  maxUses: number;
  now: number;
}

export interface CreateInviteKeyDeps {
  workspaces: Pick<WorkspaceRepository, "find">;
  invites: Pick<InviteKeyRepository, "create">;
  /** Id source, injected so tests are deterministic. */
  newId: () => string;
}

export function validateInviteKeyInput(
  input: Pick<CreateInviteKeyInput, "role" | "expiresAt" | "maxUses" | "now" | "workspaceId">,
): string | null {
  if (input.workspaceId.trim().length === 0) return "a workspace id is required";
  if (!isInviteKeyRole(input.role)) {
    return "an invite key may grant admin or member, never owner";
  }
  if (input.maxUses < 1) return "maxUses must be at least 1";
  if (!Number.isSafeInteger(input.maxUses) || input.maxUses > MAX_INVITE_USES) {
    return `maxUses must be a whole number up to ${MAX_INVITE_USES}`;
  }
  if (input.expiresAt !== null) {
    if (!Number.isFinite(input.expiresAt)) return "expiresAt must be a timestamp or null";
    if (input.expiresAt <= input.now) return "expiresAt must be in the future";
    if (input.expiresAt - input.now > MAX_INVITE_EXPIRY_MS) {
      return "expiresAt is further away than a year";
    }
  }
  return null;
}

export interface CreatedInviteKey {
  /** The only time the plaintext key exists; it is not recoverable afterwards. */
  key: string;
  record: InviteKeyRecord;
}

/**
 * Mints a key. The workspace must already belong to an organization — a key for
 * an unclaimed workspace would invite someone into nothing, and the member row
 * it redeems into has no organization to attach to.
 */
export async function createInviteKey(
  input: CreateInviteKeyInput,
  deps: CreateInviteKeyDeps,
): Promise<CreatedInviteKey> {
  if (!capabilitiesForRole(input.actorRole).canManageLinks) {
    throw new AuthError("forbidden", "only an owner or admin may create invite keys");
  }
  const problem = validateInviteKeyInput(input);
  if (problem !== null) throw new AuthError("invalid-request", problem);

  const workspace = await deps.workspaces.find(input.workspaceId.trim());
  if (workspace === null || workspace.organizationId === null) {
    throw new AuthError("workspace-not-found", "this workspace is not owned by any organization");
  }
  const actor = memberOf(workspace, input.createdByUserId);
  if (actor === null) {
    throw new AuthError("forbidden", "the creator is not a member of this workspace");
  }

  const key = generateInviteKey();
  const stored = await deps.invites.create({
    id: deps.newId(),
    workspaceId: workspace.workspaceId,
    organizationId: workspace.organizationId,
    keyHash: hashInviteKey(key),
    role: input.role,
    createdByUserId: input.createdByUserId,
    expiresAt: input.expiresAt,
    maxUses: input.maxUses,
    createdAt: input.now,
  });
  const { keyHash: _keyHash, ...record } = stored;
  return { key, record };
}

export interface RedeemInput {
  key: string;
  userId: string;
  now: number;
}

export type RedeemOutcome =
  /** The key was spent once more and this account is now a member. */
  | {
      status: "redeemed";
      organizationId: string;
      workspaceId: string;
      role: InviteKeyRole;
      member: MemberRecord;
    }
  /** The account already belonged to the organization: a no-op, not an error. */
  | {
      status: "already-member";
      organizationId: string;
      workspaceId: string;
      role: OrganizationRole;
      member: MemberRecord;
    };

/**
 * Redeems a key into a `member` row.
 *
 * The pre-checks here are for *named* refusals: a person presenting a revoked
 * key deserves "revoked", not "exhausted". They are not the safety mechanism.
 * Safety is `claimAndAddMember`'s conditional update, which is why two
 * simultaneous redemptions of a one-use key cannot both succeed even though
 * both pass every check above it — the second update matches no row.
 *
 * "Already a member" is deliberately not an error: the account already has what
 * the key would grant, and answering with a failure would make a forwarded key
 * look broken to the second person in a team who happened to be invited twice.
 * It still spends no use, because nothing is written.
 */
export async function redeemInviteKey(
  input: RedeemInput,
  deps: {
    workspaces: Pick<WorkspaceRepository, "find">;
    invites: InviteKeyRepository;
  },
): Promise<RedeemOutcome> {
  if (!looksLikeInviteKey(input.key)) {
    throw new AuthError("invite-not-found", "that invite key is not a key we issue");
  }

  const stored = await deps.invites.findByHash(hashInviteKey(input.key));
  if (stored === null) throw new AuthError("invite-not-found", "no invite key matches");
  if (stored.revokedAt !== null)
    throw new AuthError("invite-revoked", "this invite key was revoked");
  if (stored.expiresAt !== null && stored.expiresAt <= input.now) {
    throw new AuthError("invite-expired", "this invite key has expired");
  }

  const workspace = await deps.workspaces.find(stored.workspaceId);
  if (workspace === null || workspace.organizationId === null) {
    throw new AuthError("workspace-not-found", "the workspace this key invites to is gone");
  }

  const existing = memberOf(workspace, input.userId);
  if (existing !== null) {
    return {
      status: "already-member",
      organizationId: workspace.organizationId,
      workspaceId: workspace.workspaceId,
      role: existing.role,
      member: existing,
    };
  }

  if (stored.usedCount >= stored.maxUses) {
    throw new AuthError("invite-exhausted", "this invite key has no uses left");
  }

  const claimed = await deps.invites.claimAndAddMember({
    keyId: stored.id,
    workspaceId: workspace.workspaceId,
    userId: input.userId,
    role: stored.role,
    now: input.now,
  });
  if (claimed === null) {
    // The conditional update matched nothing: another redemption spent the last
    // use between our read and our write. Same answer, different cause.
    throw new AuthError("invite-exhausted", "this invite key has no uses left");
  }

  return {
    status: "redeemed",
    organizationId: workspace.organizationId,
    workspaceId: workspace.workspaceId,
    role: claimed.key.role,
    member: claimed.member,
  };
}

/** Evidence for the revocation path, and for the "a link was opened" question. */
export async function revokeInviteKey(
  input: { keyId: string; workspaceId: string; actorRole: OrganizationRole; now: number },
  deps: { invites: Pick<InviteKeyRepository, "revoke"> },
): Promise<InviteKeyRecord> {
  if (!capabilitiesForRole(input.actorRole).canManageLinks) {
    throw new AuthError("forbidden", "only an owner or admin may revoke invite keys");
  }
  const revoked = await deps.invites.revoke({ keyId: input.keyId, now: input.now });
  if (revoked === null) throw new AuthError("invite-not-found", "no invite key matches");
  const { keyHash: _keyHash, ...record } = revoked;
  return record;
}
