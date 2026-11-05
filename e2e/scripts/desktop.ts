import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
} from "@playwright/test";
import { createWorkspaceFile, LEGACY_WORKSPACE_FILE_KIND, WorkspaceDocument } from "@suite/graph";

/**
 * The desktop tier's harness.
 *
 * Two things every spec needs and neither should re-derive: an application whose
 * library and data directories are a throwaway, and a document to open. The
 * fixture is a real `.canvas` envelope written as JSON, so a spec can also write
 * a damaged one on purpose.
 */

const E2E_DIR = resolve(fileURLToPath(import.meta.url), "..", "..");
const APP_DIR = resolve(E2E_DIR, "..", "apps", "desktop");

export interface Sandbox {
  readonly root: string;
  readonly library: string;
  readonly data: string;
  documentPath(name: string): string;
  dispose(): Promise<void>;
}

export async function sandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "suite-desktop-e2e-"));
  const library = join(root, "Documents", "Suite", "Canvas");
  const data = join(root, "data");
  await mkdir(library, { recursive: true });
  await mkdir(data, { recursive: true });
  return {
    root,
    library,
    data,
    documentPath: (name: string) => join(library, name),
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

export interface Launched {
  readonly app: ElectronApplication;
  readonly page: Page;
  /** Everything the renderer logged, for a failure that only shows there. */
  readonly console: string[];
  close(): Promise<void>;
}

/**
 * Launch the packaged main process with a file, under a sandbox.
 *
 * The canvas bundle is built first: the desktop app loads `apps/canvas/dist`
 * rather than compiling the renderer itself, which is what keeps one renderer
 * rather than two.
 */
export async function launch(
  box: Sandbox,
  args: readonly string[] = [],
  options: { readonly profile?: string } = {},
): Promise<Launched> {
  const messages: string[] = [];
  // Electron's own single-instance lock is scoped to the user-data directory, so
  // a second process that should reach the *file* lock needs its own profile.
  // Without it the second launch exits before it ever reads a document.
  const profileArgs = options.profile ? [`--user-data-dir=${join(box.root, options.profile)}`] : [];
  const app = await electron.launch({
    args: [APP_DIR, ...args, ...profileArgs],
    env: {
      ...process.env,
      SUITE_CANVAS_LIBRARY: box.library,
      SUITE_CANVAS_DATA: box.data,
      SUITE_SHELL_VERSION: "0.1.0-e2e",
    },
    timeout: 45_000,
  });

  const page = await app.firstWindow();
  page.on("console", (message) => messages.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));

  return {
    app,
    page,
    console: messages,
    close: async () => {
      await app.close().catch(() => {
        // A window already destroyed is a clean close from the test's point of view.
      });
    },
  };
}

/**
 * Wait until the preload bridge is present, which is what makes this a desktop run.
 *
 * Polling rather than `waitForFunction`: the shell loads the launcher and then
 * navigates to the document, so a wait that runs through a navigation throws
 * instead of retrying. `expect.poll` retries the whole callback, including that.
 */
export async function waitForBridge(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(() =>
            Boolean((globalThis as { suiteDesktop?: unknown }).suiteDesktop),
          );
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

/**
 * Wait until the shell has a document open.
 *
 * It asks the main process rather than reading the page, because the page's copy
 * of that fact is the thing under test: a renderer that renders a board while
 * the shell holds no document is exactly the bug this wait would otherwise hide.
 */
export async function waitForDocument(page: Page): Promise<void> {
  await waitForBridge(page);
  // The document URL is what the renderer navigates to; waiting for it means the
  // next evaluate cannot be destroyed by the navigation that is still in flight.
  await page.waitForURL(/[?&]workspace=/u, { timeout: 30_000 });
  await expect
    .poll(async () => (await openInfo(page).catch(() => null)) !== null, { timeout: 30_000 })
    .toBe(true);
}

/** Read the document the shell has open. */
export async function openInfo(page: Page): Promise<{
  workspaceId: string;
  path: string;
  name: string;
  migratedFrom: string | null;
  recoveredFrom: string | null;
} | null> {
  return page.evaluate(async () => {
    const bridge = (globalThis as { suiteDesktop?: { documentInfo(): Promise<unknown> } })
      .suiteDesktop;
    return (await bridge?.documentInfo()) as never;
  });
}

export interface FixtureOptions {
  readonly workspaceId?: string;
  readonly name?: string;
  readonly cards?: number;
  /** Write the pre-rename envelope, so a spec can exercise the conversion. */
  readonly legacy?: boolean;
}

/**
 * A real document, written by the same writer the product uses.
 *
 * Building it with `createWorkspaceFile` rather than by hand is what keeps this
 * fixture honest: a hand-written envelope would pass a decoder the product no
 * longer matches.
 */
export function workspaceEnvelope(options: FixtureOptions = {}): string {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.renameBoard(board.id, options.name ?? "Research");
  for (let index = 0; index < (options.cards ?? 1); index += 1) {
    workspace.createCard({
      id: `card-${index + 1}`,
      boardId: board.id,
      position: { x: 60 + index * 40, y: 60 },
    });
  }
  const { file } = createWorkspaceFile(
    options.workspaceId ?? "ws-desktop-fixture",
    workspace,
    "2026-11-04T20:00:00.000Z",
  );
  return JSON.stringify(
    options.legacy ? { ...file, kind: LEGACY_WORKSPACE_FILE_KIND, version: 2 } : file,
    null,
    2,
  );
}

export async function writeDocument(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
}

export async function truncateDocument(path: string, bytes: number): Promise<void> {
  await truncate(path, bytes);
}

export async function readDocument(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function libraryEntries(library: string): Promise<string[]> {
  return readdir(library);
}
