import type { WorkspaceDataErasure, WorkspaceDataStore } from "@suite/auth";

/**
 * The relay's address and the credential the control plane presents to it.
 *
 * Two variables rather than the relay's operator token: the account service is
 * the process with an internet-facing sign-in surface and an account database,
 * and the operator's own authority would let a bug here reach every workspace's limits,
 * rooms and links. This credential opens exactly one relay operation — purge the
 * workspace named in the path — so a compromise of this process costs documents,
 * not the relay's whole operator surface. The relay reads the token under the
 * same name; the URL is this process's own.
 */
export const RELAY_URL_VARIABLE = "SUITE_RELAY_URL";
export const RELAY_PURGE_TOKEN_VARIABLE = "SUITE_RELAY_PURGE_TOKEN";

/**
 * A purge that has not answered by now has failed. The erase is a whole-account
 * request: waiting forever on one workspace holds the account open and, worse,
 * holds it open with some of its data already deleted. Ten seconds is long enough
 * for a relay deleting a large document on a slow disk.
 */
export const PURGE_TIMEOUT_MS = 10_000;

/**
 * The relay's workspace delete, hard-coded here.
 *
 * `apps/collab-server` exports the same path, and this package deliberately does
 * not depend on the relay: the control plane is the half that must stay up when
 * the relay does not. A path is the whole coupling, and it is checked by
 * `pnpm db:verify`, which drives both halves against a real file store.
 */
export const RELAY_PURGE_PATH = "/api/workspaces";

/** A count from the relay's answer, or zero for a field that is missing or not a number. */
export function countOf(body: Record<string, unknown>, name: string): number {
  const value = body[name];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The relay's per-workspace stores as an HTTP port, or `null` when this
 * deployment names no relay.
 *
 * `null` is not a failure: a self-host that mounts no relay has nothing to erase,
 * and the erase report says so for each of the three stores instead of pretending
 * a delete happened. `SUITE_RELAY_URL` and `SUITE_RELAY_PURGE_TOKEN` are one
 * switch: half a pair is a deployment that cannot purge, so it reads as absent
 * rather than as a port that fails every call.
 *
 * `erase` maps the relay's own counts — a workspace document plus its projected
 * share rooms are the document store, share rows plus their draft baselines are
 * the share store — so the report's three numbers mean what the report says they
 * mean. A response that is not `2xx` throws, which keeps the account whole: the
 * erase stops before its Postgres transaction and the caller retries.
 */
export function relayWorkspaceData(
  env: Readonly<Record<string, string | undefined>>,
  fetcher: typeof fetch = fetch,
): WorkspaceDataStore | null {
  const base = (env[RELAY_URL_VARIABLE] ?? "").trim().replace(/\/+$/u, "");
  const token = (env[RELAY_PURGE_TOKEN_VARIABLE] ?? "").trim();
  if (base.length === 0 || token.length === 0) return null;
  // Checked now, at boot, rather than inside the one route that would discover it:
  // a malformed URL is an operator typo, and a startup error naming the variable
  // is cheaper to read than a failed erasure a month later.
  const url = new URL(base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${RELAY_URL_VARIABLE} must be an http or https URL, got "${url.protocol}//"`);
  }

  return {
    /**
     * Reading share rows is not part of this credential: the purge token may
     * delete a workspace's shares, not list them. The export catches this and
     * carries the reason on each workspace, which is the same shape it uses for a
     * deployment with no relay at all.
     */
    shares: async (workspaceId: string) => {
      throw new Error(
        `the relay exposes no service read for the share rows of ${workspaceId}; the purge credential may delete a workspace's shares, not read them`,
      );
    },
    erase: async (workspaceId: string): Promise<WorkspaceDataErasure> => {
      const response = await fetcher(
        `${url.origin}${url.pathname === "/" ? "" : url.pathname}${RELAY_PURGE_PATH}/${encodeURIComponent(workspaceId)}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          // The relay requires the id in the body of a delete, so a mangled URL
          // cannot purge the wrong workspace. Same shape as the account's own.
          body: JSON.stringify({ confirm: workspaceId }),
          signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 200);
        throw new Error(
          `the relay answered ${response.status}${detail.length === 0 ? "" : `: ${detail}`}`,
        );
      }
      const body: unknown = await response.json();
      const counts =
        typeof body === "object" && body !== null && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : {};
      return {
        // The workspace's own document rows and the share rooms projected from it.
        documents: countOf(counts, "documents") + countOf(counts, "projected"),
        // Share rows and the draft baseline each one may have.
        shares: countOf(counts, "shares") + countOf(counts, "baselines"),
        attachments: countOf(counts, "attachments"),
      };
    },
  };
}
