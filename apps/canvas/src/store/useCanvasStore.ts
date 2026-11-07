import { WorkspaceDocument } from "@suite/graph";
import { EphemeralStore, LoroDoc } from "loro-crdt";
import { CursorEphemeralStore } from "loro-prosemirror";
import { create } from "zustand";
import { TAB_ID } from "../collab/tabId";
import { markBoot, measureBoot } from "../dev/bootTiming";
import type { SyncState } from "../feedback/syncState";
import { hostKind } from "../host/bridge";
import { getSession } from "../session/session";
import { createWorkspacePersistence } from "../storage/workspacePersistence";

/** One device this workspace holds, as the host describes it. */
export interface SyncMember {
  readonly deviceId: string;
  readonly name: string;
  readonly role: "owner" | "editor" | "viewer";
}

/**
 * What sync is doing, and who is here.
 *
 * The renderer never learns a key, a frame or an epoch: this is the whole of what the main
 * process says about a shared workspace, and everything the interface draws comes from it.
 */
export interface SyncInfo {
  readonly workspaceId: string | null;
  readonly deviceId: string;
  readonly status: SyncState;
  readonly members: readonly SyncMember[];
  /** What this device has said about its way back in; null until anybody asked. */
  readonly kit?: "made" | "declined" | null;
  /** What went wrong when something did, in the words of whatever refused. */
  readonly problem?: string;
}

function searchParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/**
 * The sync doors main exposes.
 *
 * The renderer never holds a key or a socket: it exports a document update and receives
 * one back. Both directions are plain arrays because this crosses a context boundary.
 */
/** What the hub on this machine says about itself. */
export interface HubInfo {
  readonly running: boolean;
  readonly address: string | null;
  readonly scope: "loopback" | "network";
}

/** What came of asking to open a recovery file. */
export type KitImportResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "cancelled" }
  | { readonly ok: false; readonly reason: "passphrase"; readonly path: string }
  | { readonly ok: false; readonly reason: "message"; readonly message: string };

interface SyncBridge {
  syncEnable(url: string): Promise<unknown>;
  syncDisable(): Promise<unknown>;
  syncStatus(): Promise<SyncInfo | null>;
  syncPublish(update: number[]): Promise<unknown>;
  syncInvite(role: "editor" | "viewer"): Promise<string | null>;
  syncJoin(link: string): Promise<unknown>;
  onSyncIncoming(listener: (update: number[]) => void): void;
  onSyncChanged(listener: (info: SyncInfo) => void): void;
  onSyncSnapshotWanted(listener: () => void): void;
  syncPresence(update: number[]): Promise<unknown>;
  onSyncPresence(listener: (update: number[]) => void): void;
  syncRemove(deviceId: string): Promise<{ problem?: string } & Record<string, unknown>>;
  syncExportKit(passphrase: string | null): Promise<string | null>;
  syncImportKit(request: {
    path?: string;
    passphrase?: string;
  }): Promise<KitImportResult & { status?: unknown }>;
  syncDeclineKit(): Promise<unknown>;
  syncHub(): Promise<HubInfo | null>;
}

function syncBridge(): SyncBridge | null {
  const bridge = (globalThis as { suiteDesktop?: Partial<SyncBridge> }).suiteDesktop;
  return bridge?.onSyncIncoming === undefined ? null : (bridge as SyncBridge);
}

/** A workspace owns its boards and cards. `?doc=` remains a legacy alias. */
export function resolveWorkspaceId(): string | null {
  return searchParam("workspace") ?? searchParam("doc");
}

export function resolveBoardId(): string | null {
  return searchParam("board");
}

/**
 * The document this tab edits: the workspace room, or the projection room of a
 * share link. Both come from the session so a share never reads the owner's id.
 */
const SESSION = getSession();
export const WORKSPACE_ID = SESSION.workspaceId;
const ROOM_ID = SESSION.roomId;

const doc = new LoroDoc();
const workspace = new WorkspaceDocument(doc);
/**
 * Cursors, selections and who is where.
 *
 * The timeout is what makes a crash and a departure look the same: a peer is forgotten after
 * three missed beats, and the beat is one every five seconds.
 */
const presence = new EphemeralStore(15_000);
const cursors = new CursorEphemeralStore(TAB_ID, 30_000);

// Keyed by room, not workspace: a viewer of a board projection must not load
// whatever this browser cached for the owner's workspace. The host decides which
// adapter backs the local copy; nothing here knows whether it is IndexedDB or a
// file owned by the main process.
const persistence = createWorkspacePersistence({
  host: hostKind(),
  roomId: ROOM_ID,
  doc,
  indexedDb: typeof indexedDB !== "undefined",
});

markBoot("store:created");

interface CanvasState {
  workspace: WorkspaceDocument;
  presence: EphemeralStore;
  cursors: CursorEphemeralStore;
  /**
   * Null until the transport exists.
   *
   * The sync client runs in the main process, because the key schedule does, so the
   * renderer will hand it a document update rather than open a socket itself.
   */
  provider: null;
  /** What sync is doing and who is here. Null in a build with no main process. */
  sync: SyncInfo | null;
  /** True once local storage has hydrated. */
  ready: boolean;
  /** True once there is nothing left to wait for before the board can paint. */
  synced: boolean;
  /** True when a transport exists in this build, which is the desktop shell. */
  syncEnabled: boolean;
  connect: () => void;
  /** Ask main what sync is doing, for the first paint and after a change. */
  refreshSync: () => Promise<void>;
  /** Opt in: share this workspace from the machine at `url`. */
  enableSync: (url: string) => Promise<void>;
  /** Stop syncing. The local document is untouched. */
  disableSync: () => Promise<void>;
  /** Hand back a link to give someone. Null when sync is not on. */
  inviteSomeone: (role: "editor" | "viewer") => Promise<string | null>;
  /** Take a device out. Answers with what went wrong, or null. */
  removeDevice: (deviceId: string) => Promise<string | null>;
  /** Where the hub on this machine listens, so sharing does not begin with a paste. */
  hub: HubInfo | null;
  refreshHub: () => Promise<void>;
  /** Write a way back in. Answers with where it went, or null when it was not written. */
  exportKit: (passphrase: string | null) => Promise<string | null>;
  /** Install a way back in from a file somebody kept. */
  importKit: (request: { path?: string; passphrase?: string }) => Promise<KitImportResult>;
  /** Say no, and stop being asked for this workspace. */
  declineKit: () => Promise<void>;
  /** Join from a link somebody shared. */
  joinWorkspace: (link: string) => Promise<void>;
  /**
   * Persist locally and wait until the room has the latest local version.
   * Publishes call this so the server never reads a draft the transport has
   * not received yet.
   */
  flush: () => Promise<void>;
  /** Rejoin the host. A no-op until the transport exists. */
  rejoin: () => void;
  /**
   * Stops writing this document to this browser. Used by “Forget this browser”:
   * without it, the pagehide flush would recreate the copy just deleted.
   */
  forgetLocal: () => void;
}

export const useCanvasStore = create<CanvasState>((set) => {
  // A launch syncs with nothing: sync is opt-in, and the default has to be the private
  // one. The transport lives in main with the key schedule, so the renderer only ever
  // hands over an update or receives one.
  const sync = syncBridge();
  if (sync !== null) {
    sync.onSyncIncoming((update) => {
      try {
        doc.import(Uint8Array.from(update));
      } catch (error) {
        console.warn("[sync] an update from the host did not apply", error);
      }
    });
    // Local commits only: an import would otherwise echo straight back to the host.
    doc.subscribeLocalUpdates((update) => {
      void sync.syncPublish(Array.from(update));
    });

    // Somebody was just let in. They cannot read anything sealed before they joined, so the
    // only way they see this workspace is a copy of it handed over now.
    sync.onSyncSnapshotWanted(() => {
      void sync.syncPublish(Array.from(doc.export({ mode: "snapshot" })));
    });

    // Main pushes every change of state, so the title bar and the dialog redraw from one
    // source rather than each asking and drifting.
    sync.onSyncChanged((info) => set({ sync: info }));
    void sync.syncStatus().then((info) => set({ sync: info }));

    // Presence is the one thing both directions carry in bulk: cursors move constantly and
    // nobody should keep them. Local updates go out; what comes back is applied to the same
    // store, which drops a peer on its own when the beats stop.
    presence.subscribeLocalUpdates((update) => {
      void sync.syncPresence(Array.from(update));
    });
    sync.onSyncPresence((update) => {
      try {
        presence.apply(Uint8Array.from(update));
      } catch (error) {
        console.warn("[sync] presence from the host did not apply", error);
      }
    });
  }

  if (persistence) {
    markBoot("hydrate:start");
    void persistence
      .load()
      .catch((error) => console.warn("[loro] local hydration failed", error))
      .finally(() => {
        markBoot("hydrate:end");
        measureBoot("hydrate", "hydrate:start", "hydrate:end");
        set({ ready: true });
      });
  } else {
    markBoot("hydrate:end");
  }

  const flush = () => {
    void persistence?.flush();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  return {
    workspace,
    presence,
    cursors,
    provider: null,
    sync: null,
    ready: persistence === null,
    synced: true,
    syncEnabled: sync !== null,
    connect: () => {},
    refreshSync: async () => {
      const info = await sync?.syncStatus();
      set({ sync: info ?? null });
    },
    enableSync: async (url) => {
      await sync?.syncEnable(url);
      const info = await sync?.syncStatus();
      if (info != null) set({ sync: info });
    },
    inviteSomeone: async (role) => (await sync?.syncInvite(role)) ?? null,
    removeDevice: async (deviceId) => {
      const result = await sync?.syncRemove(deviceId);
      return result?.problem ?? null;
    },
    hub: null,
    refreshHub: async () => {
      const hub = await sync?.syncHub();
      set({ hub: hub ?? null });
    },
    exportKit: async (passphrase) => (await sync?.syncExportKit(passphrase)) ?? null,
    importKit: async (request) => {
      const result = await sync?.syncImportKit(request);
      if (result === undefined) return { ok: false, reason: "message", message: "No app shell." };
      return result;
    },
    declineKit: async () => {
      await sync?.syncDeclineKit();
    },
    joinWorkspace: async (link) => {
      await sync?.syncJoin(link);
      const info = await sync?.syncStatus();
      if (info != null) set({ sync: info });
    },
    disableSync: async () => {
      await sync?.syncDisable();
      const info = await sync?.syncStatus();
      if (info != null) set({ sync: info });
    },
    flush: async () => {
      await persistence?.flush();
    },
    rejoin: () => {},
    forgetLocal: () => {
      persistence?.destroy();
    },
  };
});
