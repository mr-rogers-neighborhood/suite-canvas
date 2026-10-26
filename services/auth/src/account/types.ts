import type { OrganizationRole } from "../types.js";

/**
 * What an account owns, as the export and the erase read it.
 *
 * The two operations share one snapshot because they answer the same question from
 * opposite ends: the export prints it, the erase decides what deleting it means. A
 * second read in the erase would let the export and the delete disagree about which
 * organizations are the account's, which is the one mistake an erasure request
 * cannot survive.
 */

/** The `user` row, minus the columns a client may set. */
export interface AccountProfile {
  userId: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  /** Epoch milliseconds, like every timestamp the app stores. */
  createdAt: number;
  /** When an operator admitted the account, or null while it waits. */
  admittedAt: number | null;
}

/** One organization the account belongs to, and the seat it holds there. */
export interface AccountOrganization {
  organizationId: string;
  name: string;
  slug: string;
  createdAt: number;
  /** The account's own role. Other members' rows are never read. */
  role: OrganizationRole;
  joinedAt: number;
  /**
   * How many *other* people hold a seat here. It decides whether deleting this
   * organization is the account's business, so it is read but never exported: a
   * headcount is not the account's data.
   */
  otherMembers: number;
}

/** A workspace row: the mirror of one document, never the document. */
export interface AccountWorkspace {
  workspaceId: string;
  organizationId: string | null;
  name: string;
  createdAt: number;
  archivedAt: number | null;
}

/**
 * A share link's metadata, as the relay holds it.
 *
 * No token and no hash: the hash is a working credential, and the export is a file
 * that a user forwards to their own laptop, a support inbox or a lawyer.
 */
export interface AccountShare {
  shareId: string;
  scope: string;
  role: string | null;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

/** Everything the control plane can name as the account's, in one read. */
export interface AccountSnapshot {
  profile: AccountProfile;
  organizations: readonly AccountOrganization[];
  workspaces: readonly AccountWorkspace[];
}

/** A workspace with the document reference and share rows the export carries. */
export interface ExportedWorkspace {
  workspaceId: string;
  name: string;
  createdAt: number;
  archivedAt: number | null;
  /**
   * Where the document bytes are. They are never inlined: a `.suite` file already
   * exports one workspace, and copying every snapshot into an account export would
   * make the file a second, unversioned copy of every document.
   */
  document: {
    format: "suite";
    exportedHere: false;
    exportPath: string;
    note: string;
  };
  /** Share metadata when the relay answered, or the reason it did not. */
  shares: readonly AccountShare[];
  sharesUnavailableReason?: string;
}

export interface ExportedOrganization {
  organizationId: string;
  name: string;
  slug: string;
  createdAt: number;
  /** The account's own membership: its role and when it joined. */
  membership: { role: OrganizationRole; joinedAt: number };
  workspaces: readonly ExportedWorkspace[];
}

/** The downloadable account export, versioned so a reader can tell its shape. */
export interface AccountExport {
  format: "suite-account";
  version: 1;
  exportedAt: number;
  account: AccountProfile;
  organizations: readonly ExportedOrganization[];
  /**
   * The part a machine cannot infer from the data: what this file does not contain,
   * and where to get it. It is written into the file rather than only into the docs
   * because the file outlives the page someone read before downloading it.
   */
  notes: {
    documents: string;
    shares: string;
    otherPeople: string;
    /** Credential material is not account data: a session token is a key, not a row. */
    credentials: string;
  };
}

/** The stores an erase reports on, one entry each. */
export const erasureStores = [
  "organizations",
  "members",
  "workspaces",
  "invitations",
  "invites",
  "licences",
  "subscriptions",
  "sessions",
  "accounts",
  "verifications",
  "passkeys",
  "twoFactor",
  "users",
  "documents",
  "shares",
  "attachments",
] as const;

export type ErasureStore = (typeof erasureStores)[number];

/**
 * How one store ended.
 *
 * `removed` with `removed: 0` is a success: there was nothing to delete. `not-removed`
 * is a refusal or a fault, `not-attempted` means an earlier store failed and the rest
 * was skipped, and `not-configured` means this deployment has no repository for that
 * store at all. The last one is why the report exists: a bare `200` would read as
 * "everything is gone" on a deployment where the document store was never wired.
 */
export type ErasureStatus = "removed" | "not-removed" | "not-attempted" | "not-configured";

export interface ErasureStoreReport {
  store: ErasureStore;
  status: ErasureStatus;
  /**
   * Rows or bytes removed. Documents count document rows, `shares` counts share rows
   * and their draft baselines, and `attachments` counts attachment rows.
   */
  removed: number;
  reason?: string;
  /** The command or route an operator runs to finish what this store did not. */
  followUp?: string;
}

/** What the erase plan asks the control-plane store to delete. */
export interface ErasurePlan {
  userId: string;
  /** Organizations the account is the only member of; the whole row goes. */
  organizations: readonly string[];
  /** Workspaces of those organizations; deleted with them, and listed for the relay. */
  workspaces: readonly string[];
  /**
   * The address on the `user` row. `verification` rows name an address rather than a
   * user id, so it is the only key that reaches a magic link or a verification token
   * the account asked for.
   */
  email: string | null;
}

/** The rows one control-plane transaction removed. */
export interface ErasureCounts {
  organizations: number;
  members: number;
  workspaces: number;
  invitations: number;
  invites: number;
  licences: number;
  subscriptions: number;
  sessions: number;
  accounts: number;
  verifications: number;
  passkeys: number;
  twoFactor: number;
  users: number;
}

/** What the relay removed for one workspace. */
export interface WorkspaceDataErasure {
  /** The workspace document and every projection room of it. */
  documents: number;
  /** Share rows and their draft baselines. */
  shares: number;
  /** Attachment rows, and with them the bytes they describe. */
  attachments: number;
}

/** One organization's fate in the report. */
export interface OrganizationErasure {
  organizationId: string;
  outcome: "removed" | "retained" | "not-attempted";
  reason?: string;
}

/** One workspace's fate in the report, including its relay-owned stores. */
export interface WorkspaceErasure {
  workspaceId: string;
  organizationId: string | null;
  outcome: "removed" | "retained" | "not-removed" | "not-attempted";
  reason?: string;
  /** The route or command that finishes a workspace the erase did not remove. */
  followUp?: string;
}

/**
 * The answer to "delete my account".
 *
 * `deleted` says whether the account row is gone. `complete` says whether every store
 * it owned was emptied. They are separate because the honest answer can be "the
 * account is gone and three relay stores were never reached", and collapsing the two
 * would either hide the leftovers or refuse to delete an account over them.
 */
export interface AccountErasureReport {
  ok: true;
  deleted: boolean;
  complete: boolean;
  userId: string;
  completedAt: number;
  organizations: readonly OrganizationErasure[];
  workspaces: readonly WorkspaceErasure[];
  stores: readonly ErasureStoreReport[];
  /** What a retry will do, in one sentence, when the erase did not finish. */
  retry: string;
}
