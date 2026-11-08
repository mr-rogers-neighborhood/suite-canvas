/*
 * The bridge, and nothing else.
 *
 * This is CommonJS on purpose. The renderer is sandboxed, and a sandboxed
 * preload cannot use ESM imports — it runs with `require` limited to `electron`
 * and a handful of Node built-ins. So the channel names are spelled here rather
 * than imported, and `preload.test.ts` fails if they drift from
 * `src/shared/ipc.ts`, which stays the source of truth.
 *
 * `contextIsolation` is on, so this is the entire surface the page can reach.
 * No method takes a path: the page says *what* to save, never *where*, so a
 * document cannot steer a write.
 */
const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = {
  loadDocument: "suite:document:load",
  saveDocument: "suite:document:save",
  flushDocument: "suite:document:flush",
  documentInfo: "suite:document:info",
  appInfo: "suite:app:info",
  createDocument: "suite:document:create",
  openFileDialog: "suite:document:pick",
  openDocument: "suite:document:open",
  recentFiles: "suite:document:recents",
  forgetRecent: "suite:document:forget",
  syncStatus: "suite:sync:status",
  syncEnable: "suite:sync:enable",
  syncDisable: "suite:sync:disable",
  syncPublish: "suite:sync:publish",
  syncIncoming: "suite:sync:incoming",
  syncChanged: "suite:sync:changed",
  syncInvite: "suite:sync:invite",
  syncJoin: "suite:sync:join",
  syncSnapshotWanted: "suite:sync:snapshot-wanted",
  syncPresence: "suite:sync:presence",
  syncPresenceIncoming: "suite:sync:presence-incoming",
  syncRemove: "suite:sync:remove",
  syncExportKit: "suite:sync:export-kit",
  syncImportKit: "suite:sync:import-kit",
  syncDeclineKit: "suite:sync:decline-kit",
  syncHub: "suite:sync:hub",
};

contextBridge.exposeInMainWorld("suiteDesktop", {
  // What `hostKind()` in the renderer looks for. Its presence is what makes the
  // app a desktop app.
  host: "desktop",
  version: process.env.SUITE_SHELL_VERSION || "0.0.0",
  platform: process.platform,
  loadDocument: () => ipcRenderer.invoke(CHANNELS.loadDocument),
  saveDocument: (request) => ipcRenderer.invoke(CHANNELS.saveDocument, request),
  flushDocument: () => ipcRenderer.invoke(CHANNELS.flushDocument),
  documentInfo: () => ipcRenderer.invoke(CHANNELS.documentInfo),
  appInfo: () => ipcRenderer.invoke(CHANNELS.appInfo),
  createDocument: (seed) => ipcRenderer.invoke(CHANNELS.createDocument, seed),
  openFileDialog: () => ipcRenderer.invoke(CHANNELS.openFileDialog),
  openDocument: (path) => ipcRenderer.invoke(CHANNELS.openDocument, path),
  recentFiles: () => ipcRenderer.invoke(CHANNELS.recentFiles),
  forgetRecent: (path) => ipcRenderer.invoke(CHANNELS.forgetRecent, path),

  // Sync. The page hands over an exported update and receives one back; the keys and
  // the socket stay in main, which is the whole reason these are the only two doors.
  syncStatus: () => ipcRenderer.invoke(CHANNELS.syncStatus),
  syncEnable: (url) => ipcRenderer.invoke(CHANNELS.syncEnable, url),
  syncDisable: () => ipcRenderer.invoke(CHANNELS.syncDisable),
  syncPublish: (update) => ipcRenderer.invoke(CHANNELS.syncPublish, update),
  onSyncIncoming: (listener) => {
    ipcRenderer.on(CHANNELS.syncIncoming, (_event, update) => listener(update));
  },
  onSyncChanged: (listener) => {
    ipcRenderer.on(CHANNELS.syncChanged, (_event, info) => listener(info));
  },
  syncInvite: (role) => ipcRenderer.invoke(CHANNELS.syncInvite, role),
  syncJoin: (link) => ipcRenderer.invoke(CHANNELS.syncJoin, link),
  onSyncSnapshotWanted: (listener) => {
    ipcRenderer.on(CHANNELS.syncSnapshotWanted, () => listener());
  },
  syncPresence: (update) => ipcRenderer.invoke(CHANNELS.syncPresence, update),
  onSyncPresence: (listener) => {
    ipcRenderer.on(CHANNELS.syncPresenceIncoming, (_event, update) => listener(update));
  },
  syncRemove: (deviceId) => ipcRenderer.invoke(CHANNELS.syncRemove, deviceId),
  syncExportKit: (passphrase) => ipcRenderer.invoke(CHANNELS.syncExportKit, passphrase),
  syncImportKit: (request) => ipcRenderer.invoke(CHANNELS.syncImportKit, request),
  syncDeclineKit: () => ipcRenderer.invoke(CHANNELS.syncDeclineKit),
  syncHub: () => ipcRenderer.invoke(CHANNELS.syncHub),
});
