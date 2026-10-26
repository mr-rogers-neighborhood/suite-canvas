/**
 * Claim on sign-in (ADR-0067 §2).
 *
 * A device that has been working without an account holds workspaces nobody owns.
 * The moment a session exists, those workspaces are handed to the session's
 * organization — one `UPDATE` per workspace, through `POST /api/workspaces/claim`.
 *
 * **Claiming changes no id, no URL and no share link.** `workspaces.id` *is* the
 * document id (ADR-0065 §2), and this module sends that id and nothing else: no
 * rename, no local document rewrite, no navigation. Nothing here can disturb the
 * work, and a refusal is equally quiet — the workspace simply stays local and
 * keeps working, which is the whole point of the anonymous rung.
 *
 * Which workspaces? The ones this device already keeps: the recent-workspaces
 * list plus the workspace currently open. That list is where the app already
 * records local workspaces, so nothing new has to be persisted to make the claim
 * possible. A workspace created *after* sign-in is claimed lazily, when it is
 * opened — see `account.ts`.
 */

/** The organization a claim would land in, or the server's reason it cannot. */
export type OrganizationAnswer = { ok: true; organizationId: string } | { ok: false; code: string };

/** One claim's answer: the server's status, or its refusal code. */
export type ClaimAnswer =
  | { ok: true; status: "claimed" | "unchanged" }
  | { ok: false; code: string };

export interface ClaimDeps {
  /** Local workspace ids this device holds, in the order worth claiming. */
  workspaceIds: () => readonly string[];
  /** The organization to claim into — creating one if the account has none. */
  organization: () => Promise<OrganizationAnswer>;
  /** `POST /api/workspaces/claim`; must resolve, never throw. */
  claim: (input: { workspaceId: string; organizationId: string }) => Promise<ClaimAnswer>;
}

/**
 * Why claiming stopped early, in the reader's terms:
 *
 * - `organization` — the account could not get an organization, so there is
 *   nothing to claim into.
 * - `admission`     — the account is on the list; the rest are refused by the same gate.
 * - `ceiling`       — the licence has no room for another workspace; the rest would fail too.
 * - `unreachable`   — the account service did not answer; retrying every id would just be noise.
 */
export type ClaimStop = "none" | "organization" | "admission" | "ceiling" | "unreachable";

export interface ClaimReport {
  claimed: readonly string[];
  unchanged: readonly string[];
  /** Per-workspace refusals that did not stop the run. */
  refused: readonly { workspaceId: string; code: string }[];
  attempted: number;
  stopped: ClaimStop;
}

const EMPTY: ClaimReport = {
  claimed: [],
  unchanged: [],
  refused: [],
  attempted: 0,
  stopped: "none",
};

/** Refusals that make every later claim in this run pointless. */
function stopFor(code: string): ClaimStop | null {
  if (code === "admission-pending") return "admission";
  if (code === "seat-refused") return "ceiling";
  if (code === "auth-not-configured" || code === "unreachable") return "unreachable";
  return null;
}

/**
 * Claims every workspace this device holds. Never throws, never blocks a local
 * edit, and never mutates a document.
 *
 * A refusal is recorded rather than retried: `workspace-already-claimed` means
 * another organization owns it (a share link brought it here, say), and
 * `forbidden` means this account may not claim at all — neither is fixed by
 * asking again for the same id, so the run moves on to the next workspace.
 */
export async function claimLocalWorkspaces(deps: ClaimDeps): Promise<ClaimReport> {
  const ids = [...new Set(deps.workspaceIds().map((id) => id.trim()))].filter(
    (id) => id.length > 0,
  );
  if (ids.length === 0) return EMPTY;

  let organization: OrganizationAnswer;
  try {
    organization = await deps.organization();
  } catch {
    return { ...EMPTY, stopped: "organization" };
  }
  if (!organization.ok) {
    return { ...EMPTY, stopped: stopFor(organization.code) ?? "organization" };
  }

  const claimed: string[] = [];
  const unchanged: string[] = [];
  const refused: { workspaceId: string; code: string }[] = [];

  for (const workspaceId of ids) {
    let answer: ClaimAnswer;
    try {
      answer = await deps.claim({ workspaceId, organizationId: organization.organizationId });
    } catch {
      return {
        claimed,
        unchanged,
        refused,
        attempted: claimed.length + unchanged.length + refused.length,
        stopped: "unreachable",
      };
    }
    if (answer.ok) {
      (answer.status === "claimed" ? claimed : unchanged).push(workspaceId);
      continue;
    }
    refused.push({ workspaceId, code: answer.code });
    const stop = stopFor(answer.code);
    if (stop !== null) {
      return {
        claimed,
        unchanged,
        refused,
        attempted: claimed.length + unchanged.length + refused.length,
        stopped: stop,
      };
    }
  }

  return {
    claimed,
    unchanged,
    refused,
    attempted: claimed.length + unchanged.length + refused.length,
    stopped: "none",
  };
}

/** Whether the run ended because the account is waiting for admission (ADR §7). */
export function admissionPending(report: ClaimReport | null): boolean {
  return report?.stopped === "admission";
}
