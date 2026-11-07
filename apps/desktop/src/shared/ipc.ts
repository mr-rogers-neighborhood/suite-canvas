/**
 * The one place the two processes agree on names.
 *
 * Every channel is a capability handed to the renderer, so the list is short and
 * each entry says what it is for. A handler that is not named here does not
 * exist as far as the preload is concerned, which is the point: `ipcMain.handle`
 * can be called from anywhere in main, but only these five are reachable.
 */

export const IPC = {
  /** The open document's identity and initial snapshot, or null when none is open. */
  loadDocument: "suite:document:load",
  /** Replace the open document's contents. Debounced in main, not here. */
  saveDocument: "suite:document:save",
  /** Wait for anything queued to reach the disk. */
  flushDocument: "suite:document:flush",
  /** Where the open document lives, for the window title and the File menu. */
  documentInfo: "suite:document:info",
  /** The shell's own version and platform, for diagnostics. */
  appInfo: "suite:app:info",
  /** Show the open dialog and open whatever is chosen. */
  openFileDialog: "suite:document:pick",
  /** Open a path the shell reported earlier, after re-validating it. */
  openDocument: "suite:document:open",
  /** What sync is doing for the open workspace. */
  syncStatus: "suite:sync:status",
  /** Opt in: point this workspace at a host. */
  syncEnable: "suite:sync:enable",
  /** Stop syncing this workspace. The local document is untouched. */
  syncDisable: "suite:sync:disable",
  /** A document update the renderer exported, on its way to the group. */
  syncPublish: "suite:sync:publish",
  /** Pushed the other way: an update to import. */
  syncIncoming: "suite:sync:incoming",
  /** Pushed when the status changes, so the status line redraws. */
  syncChanged: "suite:sync:changed",
  /** Write an invitation and return the link to give someone. */
  syncInvite: "suite:sync:invite",
  /** Join from a link somebody shared. */
  syncJoin: "suite:sync:join",
  /**
   * Pushed when somebody has been let in, so the page hands over a snapshot.
   *
   * A device that joins cannot read anything sealed before it joined, so the only way it can
   * see the workspace is if somebody gives it a copy at the epoch it joined in.
   */
  syncSnapshotWanted: "suite:sync:snapshot-wanted",
  /** Files this machine opened, newest first. */
  recentFiles: "suite:document:recents",
  /** Drop one entry from that list. */
  forgetRecent: "suite:document:forget",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** What the renderer is told when it asks what is open. */
/** What the sync service is doing, as the renderer is allowed to see it. */
export type SyncState =
  | { readonly state: "off" }
  | { readonly state: "connecting" }
  | { readonly state: "syncing"; readonly count: number }
  | { readonly state: "asleep"; readonly reason: string }
  | { readonly state: "refused"; readonly reason: string }
  /** An invitation has been used and this device is waiting to be let in. */
  | { readonly state: "waiting" };

/** One device the workspace holds, as the host describes it. */
export interface SyncMember {
  readonly deviceId: string;
  readonly name: string;
  readonly role: "owner" | "editor" | "viewer";
}

/** Everything the renderer needs to draw a status line, and nothing else. */
export interface SyncInfo {
  readonly workspaceId: string | null;
  readonly deviceId: string;
  readonly status: SyncState;
  /**
   * Who else is in this workspace and what each of them may do.
   *
   * Names and roles rather than a fingerprint: every question this raises for a person — hand
   * the link on, let this one in, remove that one — is a question about which device, and a
   * hex string cannot answer it.
   */
  readonly members: readonly SyncMember[];
}

export interface OpenDocumentInfo {
  /** The workspace id the renderer keys its store by; carried in the page URL. */
  readonly workspaceId: string;
  /** Absolute path on disk. Shown in the title bar, never used to build one. */
  readonly path: string;
  readonly name: string;
  /** True when this open converted a legacy `.suite` canvas file. */
  readonly migratedFrom: string | null;
  /** True when the file needed a backup or recovery to open. */
  readonly recoveredFrom: string | null;
}

/**
 * What the renderer sends to be written.
 *
 * The renderer owns the document and the attachments, so it supplies both. Main
 * assembles the envelope, writes it atomically and keeps the attachment section
 * it was last given, so a routine autosave does not re-encode megabytes of images.
 */
export interface SaveDocumentRequest {
  readonly workspaceId: string;
  /** The workspace's own name, used to name the file on its first save. */
  readonly title?: string;
  /** A Loro snapshot, as bytes over IPC. */
  readonly snapshot: Uint8Array;
  readonly manifest: {
    readonly boards: number;
    readonly cards: number;
    readonly types: number;
    readonly tags: number;
  };
  /** Present only when the attachment set changed. */
  readonly attachments?: readonly {
    readonly id: string;
    readonly mime: string;
    readonly name: string;
    readonly width: number | null;
    readonly height: number | null;
    readonly bytes: Uint8Array;
  }[];
}

/** One entry in the launcher's recent list. */
export interface RecentFileInfo {
  readonly path: string;
  readonly name: string;
  /** The containing directory, shown so a person can find the file. */
  readonly folder: string;
  readonly openedAt: number;
}

export interface AppInfo {
  readonly host: "desktop";
  readonly version: string;
  readonly platform: NodeJS.Platform;
}

/** Every refusal a file operation can produce, as a value rather than a throw. */
export type FileFailureCode =
  | "no-document"
  | "locked"
  | "too-large"
  | "not-a-document"
  | "corrupt"
  | "write-failed"
  | "changed-on-disk"
  | "cancelled";

export interface FileFailure {
  readonly ok: false;
  readonly code: FileFailureCode;
  /** A sentence for the user; the code is for the code. */
  readonly message: string;
}
