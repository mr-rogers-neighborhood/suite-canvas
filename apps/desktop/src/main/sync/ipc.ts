import type { WebContents } from "electron";
import { type HubInfo, IPC, type KitImportResult, type SyncInfo } from "../../shared/ipc.js";
import { readHub } from "./hubAddress.js";
import { kitFactFor } from "./kitReport.js";
import { createSyncService, type SyncService } from "./service.js";

/**
 * The sync service as the renderer sees it: four doors and a push.
 *
 * The renderer never holds a key and never opens a socket. It hands over an exported
 * document update and receives one back, which is the shape D7 chose so that no group
 * secret lives in a sandboxed page.
 */

/**
 * The file half of a recovery file, handed in rather than imported.
 *
 * Choosing a path is a dialog, which belongs to the window; reading and writing bytes is a
 * filesystem, which belongs to the machine. Keeping both as ports is what lets the rules
 * around a kit be tested without a window or a disk.
 */
export interface KitFiles {
  readonly pickSavePath: (suggestedName: string) => Promise<string | null>;
  readonly pickOpenPath: () => Promise<string | null>;
  readonly writeBytes: (path: string, bytes: Uint8Array) => Promise<void>;
  readonly readBytes: (path: string) => Promise<Uint8Array>;
}

export interface SyncIpcOptions {
  readonly dataDir: string;
  readonly currentWorkspaceId: () => string | null;
  readonly webContents: () => WebContents | null;
  /** What this device is called on the other person's screen. */
  readonly deviceName: string;
  readonly kitFiles: KitFiles;
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

  /**
   * What this device already said about its way back in, cached for the snapshot.
   *
   * Read from the report the app writes rather than asked of the service, because the fact
   * outlives any one connection and the dialog needs it before anything is connected.
   */
  let kitState: "made" | "declined" | null = null;

  const info = (status: SyncInfo["status"]): SyncInfo => ({
    workspaceId,
    deviceId: service === null ? "" : deviceIdCache,
    status,
    members: service === null ? [] : service.members(),
    kit: kitState,
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
    service = await createSyncService({
      dataDir: options.dataDir,
      workspaceId: current,
      deviceName: options.deviceName,
    });
    deviceIdCache = (await service.identity()).deviceId;
    kitState = (await kitFactFor(options.dataDir, current, deviceIdCache))?.state ?? null;

    service.onUpdate((update) => {
      // A plain array rather than a Buffer: the renderer is a different context and a
      // Uint8Array crosses IPC as one.
      options.webContents()?.send(IPC.syncIncoming, Array.from(update));
    });
    service.onStatus(announce);
    service.onPresence((update) => {
      options.webContents()?.send(IPC.syncPresenceIncoming, Array.from(update));
    });
    // A device arriving does not change what sync is doing, but it does change who a person
    // sees when they open the dialog, so the list is pushed the same way the state is.
    service.onMembers(() => announce(service?.status() ?? { state: "off" }));
    // Somebody was let in: the page owns the document, so it has to hand over a copy.
    service.onJoinedByAnother(() => {
      options.webContents()?.send(IPC.syncSnapshotWanted);
    });
    // A join that was still waiting when the app closed picks itself up here. Nothing is sent:
    // the key package is already on the host, and the invitation it spent is already gone.
    void service.resume();
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

  options.onIpc(IPC.syncPresence, async (_event, update: unknown) => {
    if (!Array.isArray(update)) return;
    await service?.presence(Uint8Array.from(update as number[]));
  });

  options.onIpc(IPC.syncRemove, async (_event, deviceId: unknown) => {
    if (typeof deviceId !== "string" || deviceId.length === 0) return info({ state: "off" });
    const current = await ensureService();
    if (current === null) return info({ state: "off" });
    try {
      await current.removeDevice(deviceId);
    } catch (error) {
      return {
        ...info(current.status()),
        problem: error instanceof Error ? error.message : "That device could not be removed.",
      };
    }
    return info(current.status());
  });

  options.onIpc(IPC.syncHub, async (): Promise<HubInfo> => readHub());

  options.onIpc(IPC.syncExportKit, async (_event, passphrase: unknown) => {
    const current = await ensureService();
    if (current === null) return null;
    const secret =
      typeof passphrase === "string" && passphrase.trim().length > 0 ? passphrase : null;
    let bytes: Uint8Array;
    try {
      bytes = await current.exportKit(secret);
    } catch (error) {
      return error instanceof Error ? error.message : "That file could not be written.";
    }
    const path = await options.kitFiles.pickSavePath("suite-way-back-in.json");
    if (path === null) return null;
    try {
      await options.kitFiles.writeBytes(path, bytes);
    } catch {
      return "That file could not be written.";
    }
    // Only now is it true: a kit the person cancelled at the file picker does not exist.
    await current.noteKit("made", secret !== null);
    kitState = "made";
    announce(current.status());
    return path;
  });

  options.onIpc(IPC.syncImportKit, async (_event, request: unknown): Promise<KitImportResult> => {
    const wanted =
      typeof request === "object" && request !== null
        ? (request as { path?: unknown; passphrase?: unknown })
        : {};
    const path =
      typeof wanted.path === "string" ? wanted.path : await options.kitFiles.pickOpenPath();
    if (path === null) return { ok: false, reason: "cancelled" };

    const current = await ensureService();
    if (current === null) return { ok: false, reason: "message", message: "No workspace is open." };

    const passphrase = typeof wanted.passphrase === "string" ? wanted.passphrase : null;
    try {
      await current.importKit(await options.kitFiles.readBytes(path), passphrase);
    } catch (error) {
      const message = error instanceof Error ? error.message : "That file could not be opened.";
      // A sealed file is the ordinary case, not a failure: ask for the word rather than
      // making somebody work out why their file will not open.
      if (/passphrase/.test(message)) return { ok: false, reason: "passphrase", path };
      return { ok: false, reason: "message", message };
    }

    kitState = "made";
    // A restored device belongs to a hub without being told twice: the hub says where it is.
    const hub = await readHub();
    if (hub.address === null) return { ok: true, status: info(current.status()) };
    return { ok: true, status: info(await current.connect(hub.address)) };
  });

  options.onIpc(IPC.syncDeclineKit, async () => {
    const current = await ensureService();
    if (current === null) return;
    await current.noteKit("declined", false);
    kitState = "declined";
    announce(current.status());
  });

  return {
    async stop() {
      await service?.disconnect();
      service = null;
    },
  };
}
