import type { WebContents } from "electron";
import { IPC, type SyncInfo } from "../../shared/ipc.js";
import { createSyncService, type SyncService } from "./service.js";

/**
 * The sync service as the renderer sees it: four doors and a push.
 *
 * The renderer never holds a key and never opens a socket. It hands over an exported
 * document update and receives one back, which is the shape D7 chose so that no group
 * secret lives in a sandboxed page.
 */

export interface SyncIpcOptions {
  readonly dataDir: string;
  readonly currentWorkspaceId: () => string | null;
  readonly webContents: () => WebContents | null;
  readonly onIpc: (
    channel: string,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) => void;
}

export interface SyncIpc {
  stop(): Promise<void>;
}

export function registerSyncIpc(options: SyncIpcOptions): SyncIpc {
  let service: SyncService | null = null;
  let workspaceId: string | null = null;

  const info = (status: SyncInfo["status"]): SyncInfo => ({
    workspaceId,
    deviceId: service === null ? "" : deviceIdCache,
    status,
  });

  let deviceIdCache = "";

  const announce = (status: SyncInfo["status"]): void => {
    options.webContents()?.send(IPC.syncChanged, info(status));
  };

  async function ensureService(): Promise<SyncService | null> {
    const current = options.currentWorkspaceId();
    if (current === null) return null;
    if (service !== null && workspaceId === current) return service;

    await service?.disconnect();
    workspaceId = current;
    service = await createSyncService({ dataDir: options.dataDir, workspaceId: current });
    deviceIdCache = (await service.identity()).deviceId;

    service.onUpdate((update) => {
      // A plain array rather than a Buffer: the renderer is a different context and a
      // Uint8Array crosses IPC as one.
      options.webContents()?.send(IPC.syncIncoming, Array.from(update));
    });
    service.onStatus(announce);
    // Somebody was let in: the page owns the document, so it has to hand over a copy.
    service.onJoinedByAnother(() => {
      options.webContents()?.send(IPC.syncSnapshotWanted);
    });
    return service;
  }

  options.onIpc(IPC.syncStatus, async () => {
    const current = await ensureService();
    if (current === null) return info({ state: "off" });
    return info(current.status());
  });

  options.onIpc(IPC.syncEnable, async (_event, url: unknown) => {
    if (typeof url !== "string" || !/^wss?:\/\//u.test(url)) return info({ state: "off" });
    const current = await ensureService();
    if (current === null) return info({ state: "off" });
    return info(await current.connect(url));
  });

  options.onIpc(IPC.syncDisable, async () => {
    await service?.disconnect();
    return info({ state: "off" });
  });

  options.onIpc(IPC.syncInvite, async (_event, role: unknown) => {
    const current = await ensureService();
    if (current === null) return null;
    const chosen = role === "viewer" ? "viewer" : "editor";
    try {
      return await current.createInvite(chosen);
    } catch {
      return null;
    }
  });

  options.onIpc(IPC.syncJoin, async (_event, link: unknown) => {
    if (typeof link !== "string") return info({ state: "off" });
    const current = await ensureService();
    if (current === null) return info({ state: "off" });
    return info(await current.join(link));
  });

  options.onIpc(IPC.syncPublish, async (_event, update: unknown) => {
    if (!Array.isArray(update)) return;
    await service?.publish(Uint8Array.from(update as number[]));
  });

  return {
    async stop() {
      await service?.disconnect();
      service = null;
    },
  };
}
