import {
  createRelayClient,
  decodeBase64,
  encodeBase64,
  exportKey,
  type Frame,
  open,
  type RelayClient,
  type RelayClientHandlers,
  type RelayWebSocketFactory,
  seal,
  signFrame,
} from "@suite/sync";
import { loadGroup, saveGroup } from "./groupStore.js";
import { type DeviceIdentity, loadOrCreateIdentity } from "./identity.js";

/**
 * One workspace's sync, owned by the main process.
 *
 * The document lives in the renderer and the keys live here, so this service is a pair of
 * doors: a document update comes in from the renderer and leaves as a sealed frame; a frame
 * arrives from the host and leaves as a document update. Nothing else crosses.
 *
 * It is deliberately not an Electron module. Paths and a socket factory are handed in, so
 * the whole thing can be tested without a window.
 */

export type SyncStatus =
  | { readonly state: "off" }
  | { readonly state: "connecting" }
  /** Connected and caught up. `count` is how many frames the host had for us. */
  | { readonly state: "syncing"; readonly count: number }
  | { readonly state: "asleep"; readonly reason: string }
  | { readonly state: "refused"; readonly reason: string };

export interface SyncServiceOptions {
  readonly dataDir: string;
  readonly workspaceId: string;
  readonly webSocket?: RelayWebSocketFactory;
}

export interface SyncService {
  /** Connect to a host this device already belongs to. */
  connect(url: string): Promise<SyncStatus>;
  disconnect(): Promise<void>;
  status(): SyncStatus;
  /** The device id and public key the host pins, for a pairing string. */
  identity(): Promise<Pick<DeviceIdentity, "deviceId" | "publicKey">>;
  /** Seal a document update from the renderer and send it. */
  publish(update: Uint8Array): Promise<void>;
  /** Hand out document updates from other devices. */
  onUpdate(handler: (update: Uint8Array) => void): void;
  onStatus(handler: (status: SyncStatus) => void): void;
}

export async function createSyncService(options: SyncServiceOptions): Promise<SyncService> {
  const identity = await loadOrCreateIdentity(options.dataDir);
  let group = await loadGroup(options.dataDir, options.workspaceId);
  let relay: RelayClient | null = null;
  let status: SyncStatus = { state: "off" };
  let updateHandler: ((update: Uint8Array) => void) | null = null;
  let statusHandler: ((status: SyncStatus) => void) | null = null;
  /** How many frames this device has taken from the host, for a catch-up request. */
  let received = 0;

  const publishStatus = (next: SyncStatus): void => {
    status = next;
    statusHandler?.(next);
  };

  const handlers: RelayClientHandlers = {
    onJoined: (info) => {
      // Ask for what arrived while this device was closed. 0 means everything the host
      // still holds, which is the honest answer for a device that has never synced.
      relay?.since(received);
      publishStatus({ state: "syncing", count: info.frames });
    },
    onFrame: (_index, frame) => {
      received += 1;
      void applyFrame(frame);
    },
    onRefused: (reason) => publishStatus({ state: "refused", reason }),
    onError: (code, message) => publishStatus({ state: "asleep", reason: `${code}: ${message}` }),
    onClosed: () => publishStatus({ state: "asleep", reason: "the host is not answering" }),
  };

  async function applyFrame(frame: Frame): Promise<void> {
    // A frame for an epoch this device has left is not late, it is irrelevant; MLS would
    // quietly decrypt it as an old application message rather than refuse it.
    if (group === null || frame.epoch < group.epoch) return;

    if (frame.kind !== "application") {
      // Handshake frames land in M5b, where an invite produces one.
      return;
    }

    const payload = decodeBase64(frame.payload);
    if (payload === null) return;

    try {
      const opened = await open(group, payload);
      group = opened.group;
      await saveGroup(options.dataDir, options.workspaceId, group);
      const plaintext: Uint8Array | null = opened.plaintext;
      if (plaintext !== null) updateHandler?.(plaintext);
    } catch {
      // A frame this device cannot read is not an error worth surfacing: it is what a
      // device that joined later sees of the past, by design.
    }
  }

  return {
    async connect(url) {
      if (relay !== null) return status;
      publishStatus({ state: "connecting" });
      try {
        relay = await createRelayClient(
          {
            url,
            workspaceId: options.workspaceId,
            deviceId: identity.deviceId,
            publicKey: identity.publicKey,
            sign: identity.sign,
            ...(options.webSocket === undefined ? {} : { webSocket: options.webSocket }),
          },
          handlers,
        );
      } catch (error) {
        publishStatus({
          state: "asleep",
          reason: error instanceof Error ? error.message : "the host is not answering",
        });
      }
      return status;
    },

    async disconnect() {
      relay?.close();
      relay = null;
      publishStatus({ state: "off" });
    },

    status: () => status,

    identity: async () => ({ deviceId: identity.deviceId, publicKey: identity.publicKey }),

    async publish(update) {
      if (relay === null || group === null) return;
      const sealed = await seal(group, update);
      group = sealed.group;
      await saveGroup(options.dataDir, options.workspaceId, group);

      const header = {
        kind: "application" as const,
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        epoch: sealed.group.epoch,
        payload: encodeBase64(sealed.message),
      };
      relay.send(signFrame(identity.sign, header));
    },

    onUpdate(handler) {
      updateHandler = handler;
    },

    onStatus(handler) {
      statusHandler = handler;
    },
  };
}

/** The key a workspace's attachments and derived names would use. Nothing uses it yet. */
export async function workspaceKey(
  service: SyncService,
  workspaceId: string,
  dataDir: string,
): Promise<Uint8Array | null> {
  const group = await loadGroup(dataDir, workspaceId);
  if (group === null) return null;
  void service;
  return exportKey(group, "suite/workspace-key", workspaceId);
}
