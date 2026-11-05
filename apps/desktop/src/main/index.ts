import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  net,
  protocol,
  shell,
} from "electron";
import { type FileFailure, IPC, type OpenDocumentInfo } from "../shared/ipc.js";
import { type DesktopPaths, desktopPaths } from "./paths.js";
import { DESKTOP_CSP, resolveAppAsset } from "./protocol.js";
import { DocumentStore, freeDocumentPath, looksLikeCanvasFile, type OpenResult } from "./store.js";

/**
 * The Canvas desktop shell.
 *
 * Its job is small and it is all here: one instance, one window, one document.
 * The renderer is the web build, unchanged, loaded from a real origin so the
 * routes it already has keep working. Everything that judges a file — the lock,
 * the write, the backups, recovery — lives in `store.ts`, which is why it can be
 * tested without a window at all.
 */

const APP_ID = "run.suite.canvas";
const RENDERER_URL = "app://canvas/index.html";

/** Files handed to a cold start, before `ready`. */
const pendingFiles: string[] = [];
let mainWindow: BrowserWindow | null = null;
let store: DocumentStore | null = null;
let paths: DesktopPaths = desktopPaths();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

/** The renderer bundle. Packaged it sits in resources; in development, beside the app. */
function rendererRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "renderer")
    : join(app.getAppPath(), "..", "canvas", "dist");
}

function attachFile(target: string): void {
  const resolved = target.trim();
  if (resolved.length === 0) return;
  if (!looksLikeCanvasFile(resolved)) return;
  pendingFiles.push(resolved);
}

/** A file argument, from a cold start or from a protocol activation. */
function fileFromArgv(argv: readonly string[]): string | null {
  for (const argument of argv.slice(1)) {
    if (argument.startsWith("-")) continue;
    if (argument.startsWith("suite://") || argument.startsWith("suite-canvas://")) continue;
    if (looksLikeCanvasFile(argument)) return argument;
  }
  return null;
}

async function openInRenderer(info: OpenDocumentInfo): Promise<void> {
  const window = mainWindow;
  if (!window) return;
  const url = new URL(RENDERER_URL);
  url.searchParams.set("workspace", info.workspaceId);
  url.searchParams.set("desktop", "1");
  window.setTitle(`${info.name} — Suite Canvas`);
  await window.loadURL(url.toString());
}

function applyMenu(): void {
  const documentOpen = store !== null;
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Open…",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            void openDocumentDialog();
          },
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          enabled: documentOpen,
          click: () => {
            void store?.flush();
          },
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Where is my file?",
          click: () => {
            const path = store?.documentInfo.path;
            if (path) shell.showItemInFolder(path);
          },
          enabled: documentOpen,
        },
        {
          label: "Suite documentation",
          click: () => {
            void shell.openExternal("https://docs.suite.run");
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openDocumentDialog(): Promise<void> {
  const window = mainWindow;
  if (!window) return;
  const picked = await dialog.showOpenDialog(window, {
    title: "Open a workspace",
    properties: ["openFile"],
    filters: [
      { name: "Suite Canvas workspace", extensions: ["canvas"] },
      { name: "Legacy Suite workspace", extensions: ["suite"] },
    ],
  });
  const target = picked.filePaths[0];
  if (picked.canceled || !target) return;
  await openDocument(target);
}

/** Open a file and hand it to the renderer, or explain why not. */
async function openDocument(path: string): Promise<void> {
  const window = mainWindow;
  if (!window) return;

  const result: OpenResult = await DocumentStore.open(path, { appId: APP_ID, paths });

  if (!result.ok) {
    // A refusal keeps the window on whatever it was showing, and says what
    // happened. Losing the open must never look like the file is gone.
    await dialog.showMessageBox(window, {
      type: result.code === "locked" ? "warning" : "error",
      title: "Suite Canvas",
      message: result.message,
      buttons: result.code === "locked" ? ["Open a copy", "Cancel"] : ["OK"],
      defaultId: 0,
      cancelId: 1,
    });
    return;
  }

  await store?.close();
  store = result.store;
  applyMenu();
  await openInRenderer(result.info);
}

async function showLauncher(): Promise<void> {
  const window = mainWindow;
  if (!window) return;
  window.setTitle("Suite Canvas");
  const url = new URL(RENDERER_URL);
  url.searchParams.set("desktop", "1");
  await window.loadURL(url.toString());
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload", "index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  // No navigation away from the bundle, and no new windows: a document that
  // carries a link opens it in the browser, never in an app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://canvas/")) event.preventDefault();
  });

  window.on("closed", () => {
    mainWindow = null;
  });

  // A quit must not lose the debounce window: the last edit is written before
  // the window goes away.
  window.on("close", (event) => {
    if (!store) return;
    const current = store;
    store = null;
    event.preventDefault();
    void current.close().finally(() => {
      window.destroy();
      if (app.isPackaged) app.quit();
    });
  });

  return window;
}

function registerIpc(): void {
  ipcMain.handle(IPC.loadDocument, () => {
    if (!store) return null;
    return { info: store.documentInfo, snapshot: store.currentSnapshot() };
  });

  ipcMain.handle(IPC.saveDocument, async (_event, request: unknown) => {
    if (store) {
      store.save(request as Parameters<DocumentStore["save"]>[0]);
      return;
    }
    // A workspace with no file yet: this save is what creates it, named after
    // the workspace rather than after a generated id.
    const saved = request as Parameters<DocumentStore["save"]>[0];
    if (typeof saved?.workspaceId !== "string") return;
    const created = await DocumentStore.create(
      await freeDocumentPath(paths.library, saved.title, saved.workspaceId),
      saved,
      { appId: APP_ID, paths },
    );
    if (!created.ok) return;
    store = created.store;
    applyMenu();
    await openInRenderer(created.info);
  });

  ipcMain.handle(IPC.flushDocument, async () => {
    if (!store) return { ok: true };
    await store.flush();
    const failure: FileFailure | null = store.lastFailure;
    return failure ?? { ok: true };
  });

  ipcMain.handle(IPC.documentInfo, () => store?.documentInfo ?? null);

  ipcMain.handle(IPC.appInfo, () => ({
    host: "desktop",
    version: app.getVersion(),
    platform: process.platform,
  }));
}

// A second launch focuses this one and hands over its file, rather than opening
// a second window on the same document.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const target = fileFromArgv(argv);
    if (target) void openDocument(target);
  });

  // macOS delivers these before `ready`, so they are registered before it.
  app.on("open-file", (event, path) => {
    event.preventDefault();
    if (app.isReady() && mainWindow) {
      void openDocument(path);
      return;
    }
    attachFile(path);
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady() && mainWindow && store) {
      // A suite:// link is Start's to route; reaching this app means the link
      // names it, and the renderer resolves what it points at.
      mainWindow.webContents.send(IPC.documentInfo, url);
    }
  });

  void app.whenReady().then(async () => {
    paths = desktopPaths();
    app.setAppUserModelId(APP_ID);

    protocol.handle("app", async (request) => {
      const resolved = resolveAppAsset(request.url, rendererRoot());
      if (!resolved.ok) return new Response("not found", { status: 404 });
      const response = await net.fetch(pathToFileURL(resolved.file).toString());
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", DESKTOP_CSP);
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, { status: response.status, headers });
    });

    registerIpc();

    const coldStart = fileFromArgv(process.argv);
    if (coldStart) attachFile(coldStart);

    mainWindow = createWindow();
    applyMenu();

    // The launcher is always the first page. A refusal — a file another window
    // holds, a file that will not parse — is then a dialog over somewhere the
    // user can work, rather than a modal above an empty window.
    await showLauncher();
    const first = pendingFiles.shift();
    if (first) await openDocument(first);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        void showLauncher();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    void store?.close();
  });
}
