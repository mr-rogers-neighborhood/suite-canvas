import { createLogger } from "../logging.js";
import type { SharePublishResult, ShareStatus } from "../projection/index.js";
import type { Share } from "../store/shares.js";

/**
 * The seams the share routes hand back to the host process. Each one is
 * best-effort: a hook that throws costs freshness or a projection, never the
 * HTTP answer the caller already earned.
 */
const logger = createLogger().child({ component: "shares" });

export interface ShareRequestHooks {
  /**
   * Called after a share is created or revoked so board and card projections can
   * follow. Optional: the share API works without a projection worker.
   */
  onSharesChanged?: (workspaceId: string) => void;
  /**
   * Saves the workspace before its first projection is built, and is awaited by
   * the create handler. Saves are coalesced (2 s), so without this a link made
   * moments after an edit would project the board as of the previous save. The
   * hook is best-effort: a failure is logged and the link is still created.
   */
  flush?: (workspaceId: string) => Promise<void> | void;
  /** A share was revoked; close its live rooms and delete its projection. */
  onShareRemoved?: (share: Share) => void;
  /**
   * Publishes an editor's draft. `version` is the share document's version
   * vector as the editor saw it, so the worker can wait for the draft to arrive.
   * `overwrite` names the conflicting keys whose draft value wins.
   */
  publish?: (
    share: Share,
    version?: Record<string, number>,
    overwrite?: readonly string[],
  ) => Promise<SharePublishResult> | SharePublishResult;
  /** Discards an editor's draft and rebuilds it from the workspace. */
  reload?: (share: Share) => Promise<SharePublishResult> | SharePublishResult;
  /** Whether the share's draft holds unpublished changes. */
  status?: (share: Share) => Promise<ShareStatus> | ShareStatus;
  /**
   * Somebody resolved this link, which is the one moment a projection room has a
   * reader. The worker opens exactly this share's room on it; without the hook a
   * link nobody resolves would still be opened at boot, once per stored link.
   * Never awaited: resolving a link must not wait for a document to load.
   */
  onShareOpened?: (share: Share) => Promise<void> | void;
}

export function notify(hooks: ShareRequestHooks | undefined, workspaceId: string): void {
  try {
    hooks?.onSharesChanged?.(workspaceId);
  } catch (error) {
    logger.error("change hook failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function notifyRemoved(hooks: ShareRequestHooks | undefined, share: Share): void {
  try {
    hooks?.onShareRemoved?.(share);
  } catch (error) {
    logger.error("removal hook failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Tells the worker that a link was opened. A failure here costs freshness, never
 * the resolve: the reader still gets the saved projection.
 */
export function notifyOpened(hooks: ShareRequestHooks | undefined, share: Share): void {
  try {
    void Promise.resolve(hooks?.onShareOpened?.(share)).catch((error: unknown) => {
      logger.warn("share open hook failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    logger.warn("share open hook failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Asks the server to save the workspace before the share is created. Awaiting
 * the save is the whole point: the projection that follows reads the *saved*
 * document, so the write has to land first. A save that fails or is unavailable
 * must not cost the owner their link, so it only logs.
 */
export async function flushWorkspace(
  hooks: ShareRequestHooks | undefined,
  workspaceId: string,
): Promise<void> {
  try {
    await hooks?.flush?.(workspaceId);
  } catch (error) {
    logger.error("save before share failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
