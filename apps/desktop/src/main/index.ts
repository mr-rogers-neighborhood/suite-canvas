import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isTrustedSender } from "@suite/desktop";
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
import {
  type FileFailure,
  IPC,
  type OpenDocumentInfo,
  type RecentFileInfo,
} from "../shared/ipc.js";
import { documentFromArgv } from "./documentLink.js";
import { type DesktopPaths, desktopPaths } from "./paths.js";
import { desktopCsp, resolveAppAsset } from "./protocol.js";
import { type RecentsStore, recentsStore } from "./recents.js";
import { devServerUrl, isRendererOrigin, rendererUrl } from "./rendererUrl.js";
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

/** Where "Support Suite…" goes. One line, so it can point at whatever page should take money. */
const SUPPORT_URL = "https://github.com/mr-rogers-neighborhood/suite-canvas";

// The single-instance lock lives in `userData`, so two copies of the shell need
// two directories. A test or a second demo profile sets this; a normal launch
// keeps the platform default and finds the document it already had.
const userDataOverride = process.env.SUITE_CANVAS_USER_DATA?.trim();
if (userDataOverride !== undefined && userDataOverride.length > 0) {
  app.setPath("userData", userDataOverride);
}

/** Files handed to a cold start, before `ready`. */
const pendingFiles: string[] = [];
let mainWindow: BrowserWindow | null = null;
let store: DocumentStore | null = null;
let paths: DesktopPaths = desktopPaths();
let recents: RecentsStore | null = null;

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

/** The document the command line names, whether a path or a link the hub routed here. */
function fileFromArgv(argv: readonly string[]): string | null {
  return documentFromArgv(argv, paths.library, looksLikeCanvasFile, existsSync);
}

async function openInRenderer(info: OpenDocumentInfo): Promise<void> {
  const window = mainWindow;
  if (!window) return;
  const url = rendererUrl();
  // No workspace id: the file is the identity, and the renderer asks the shell
  // for it. A second copy in the address bar could only disagree with the file.
  url.searchParams.set("desktop", "1");
  window.setTitle(`${info.name} — Suite Canvas`);
  await window.loadURL(url.toString());
}

function applyMenu(): void {
  const documentOpen = store !== null;
  const template: MenuItemConstructorOptions[] = [
    // The suite menu. Every item is a deep link Start resolves, so with Start
    // absent they do nothing rather than fail: the window this belongs to is
    // already the app that handles the files it opens.
    {
      label: "Suite",
      submenu: [
        {
          label: "Open Suite Start",
          click: () => {
            void shell.openExternal("suite://start/").catch(() => {
              // No handler installed: the launcher is not on this machine.
            });
          },
        },
        { type: "separator" },
        {
          label: "Open Canvas",
          click: () => {
            void shell.openExternal("suite://canvas/").catch(() => {});
          },
        },
        {
          label: "Open Planner",
          click: () => {
            void shell.openExternal("suite://planner/").catch(() => {});
          },
        },
        {
          label: "Open Budget",
          click: () => {
            void shell.openExternal("suite://budget/").catch(() => {});
          },
        },
        { type: "separator" },
        {
          label: "Show in Start",
          click: () => {
            void shell.openExternal("suite://start/").catch(() => {});
          },
        },
        {
          // The one ask in the product. No account, no paywall, nothing gated;
          // the source is MIT and stays that way whether or not anyone uses it.
          label: "Support Suite…",
          click: () => {
            void shell.openExternal(SUPPORT_URL).catch(() => {});
          },
        },
      ],
    },
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
    // Development only. A packaged build has no business offering to open the
    // same file twice, and no reason to expose the data directory.
    ...(app.isPackaged
      ? []
      : [
          {
            label: "Developer",
            submenu: [
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
              { type: "separator" as const },
              {
                label: "Reveal app data",
                click: () => {
                  void shell.openPath(paths.data);
                },
              },
              {
                // The manual test for the lock. It needs its own Electron
                // profile, or single-instance answers before the file lock is
                // ever reached and the dialog never appears.
                label: "Open this file in a second window",
                enabled: documentOpen,
                click: () => {
                  const open = store?.documentInfo.path;
                  if (!open) return;
                  const profile = join(paths.data, "second-window");
                  const child = spawn(process.execPath, [
                    app.getAppPath(),
                    `--user-data-dir=${profile}`,
                    open,
                  ]);
                  child.unref();
                },
              },
            ],
          },
        ]),
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

  await adopt(result);
  await openInRenderer(result.info);
}

/**
 * Make a freshly opened document the window's document.
 *
 * One place, so the two ways to get here — opening a file and creating one —
 * cannot disagree about what counts as history. Recording a recent is a
 * convenience, so failing it must not fail the open.
 */
async function adopt(result: Extract<OpenResult, { ok: true }>): Promise<void> {
  await store?.close();
  store = result.store;
  await recents?.remember(result.info.path).catch(() => {
    // History is a convenience; an unrecorded open is still a successful one.
  });
  applyMenu();
}

async function showLauncher(): Promise<void> {
  const window = mainWindow;
  if (!window) return;
  window.setTitle("Suite Canvas");
  const url = rendererUrl();
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
    if (!isRendererOrigin(url)) event.preventDefault();
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

/**
 * The pages this shell accepts messages from: its own bundle, and the dev
 * server when one is configured.
 */
function pageOrigins(): readonly string[] {
  const dev = devServerUrl();
  return dev === null ? ["app://canvas"] : ["app://canvas", dev];
}

/**
 * Register a channel, but only answer the page this shell loaded.
 *
 * Electron's checklist asks every handler to validate the sender. It costs one
 * comparison and closes the gap between "the window is ours" and "the message
 * came from our window".
 */
function onIpc(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event.senderFrame?.url, pageOrigins())) return undefined;
    return handler(event, ...args);
  });
}

function registerIpc(): void {
  onIpc(IPC.loadDocument, () => {
    if (!store) return null;
    return { info: store.documentInfo, snapshot: store.currentSnapshot() };
  });

  onIpc(IPC.saveDocument, async (_event, request: unknown) => {
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
    await adopt(created);
    await openInRenderer(created.info);
  });

  onIpc(IPC.flushDocument, async () => {
    if (!store) return { ok: true };
    await store.flush();
    const failure: FileFailure | null = store.lastFailure;
    return failure ?? { ok: true };
  });

  onIpc(IPC.documentInfo, () => store?.documentInfo ?? null);

  onIpc(IPC.appInfo, () => ({
    host: "desktop",
    version: app.getVersion(),
    platform: process.platform,
  }));

  onIpc(IPC.openFileDialog, () => openDocumentDialog());

  onIpc(IPC.openDocument, async (_event, target: unknown) => {
    // A path the shell itself reported earlier, re-validated here: the renderer
    // may only ask for a file this process has already opened once.
    if (typeof target !== "string") return;
    const known = (await recents?.list()) ?? [];
    if (!known.some((entry) => entry.path === target)) return;
    if (!looksLikeCanvasFile(target)) return;
    await openDocument(target);
  });

  onIpc(IPC.recentFiles, async (): Promise<readonly RecentFileInfo[]> => {
    const entries = (await recents?.list()) ?? [];
    return entries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      folder: dirname(entry.path),
      openedAt: entry.openedAt,
    }));
  });

  onIpc(IPC.forgetRecent, async (_event, target: unknown) => {
    if (typeof target !== "string") return;
    await recents?.forget(target);
  });
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

  // No `open-url` handler: `suite://` belongs to Start, which routes a link by
  // launching this app with it in `argv`. A scheme this app does not register can
  // never deliver this event, and listening for one would be a promise it cannot
  // keep.

  void app.whenReady().then(async () => {
    paths = desktopPaths();
    recents = recentsStore(paths.data);
    app.setAppUserModelId(APP_ID);

    protocol.handle("app", async (request) => {
      const resolved = resolveAppAsset(request.url, rendererRoot());
      if (!resolved.ok) return new Response("not found", { status: 404 });
      const response = await net.fetch(pathToFileURL(resolved.file).toString());
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", desktopCsp());
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
