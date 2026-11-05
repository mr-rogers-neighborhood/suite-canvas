import type { BridgeDocumentInfo, DesktopBridge } from "../host/bridge";
import { configureSession, getSession, standaloneSession } from "./session";

/**
 * The document the shell has open, resolved before the store loads.
 *
 * On the desktop the file *is* the document: the workspace id lives inside the
 * envelope, not in the address bar, so it cannot be read from a query parameter.
 * It has to arrive before `./store` is imported, because that module reads the
 * session once at import time to pick its room and its persistence.
 *
 * The snapshot is kept here rather than fetched again by the adapter. A large
 * document crossing the IPC boundary twice on open is a cost paid on every open,
 * for bytes that were already in hand.
 */

export interface DesktopBoot {
  readonly info: BridgeDocumentInfo;
  readonly snapshot: Uint8Array;
}

let boot: DesktopBoot | null = null;

/**
 * The boot snapshot, once.
 *
 * Taken rather than read: a second caller asking for it would be a bug worth
 * surfacing, not a second copy to hand out.
 */
export function takeDesktopBoot(): DesktopBoot | null {
  const current = boot;
  boot = null;
  return current;
}

/**
 * Ask the shell what is open and configure the session for it.
 *
 * Returns `"home"` when the shell has no document, which is the state the home
 * surface renders. The session still gets configured: an unconfigured session
 * would leave the store keyed to whatever the previous page had.
 */
export async function configureDesktopSession(bridge: DesktopBridge): Promise<"document" | "home"> {
  const opened = await bridge.loadDocument();
  boot = opened === null ? null : { info: opened.info, snapshot: opened.snapshot };

  const base = standaloneSession(getSession());
  configureSession({
    ...base,
    workspaceId: opened?.info.workspaceId ?? null,
    roomId: opened?.info.workspaceId ?? null,
    // A desktop build is the local profile: no share, no account, no socket.
    share: null,
    credential: "none",
  });

  return opened === null ? "home" : "document";
}
