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
});
