import { readdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { readWorkspaceFile } from "@suite/graph";
import {
  launch,
  libraryEntries,
  openInfo,
  readDocument,
  type Sandbox,
  sandbox,
  truncateDocument,
  waitForBridge,
  waitForDocument,
  workspaceEnvelope,
  writeDocument,
} from "../../scripts/desktop.js";

/**
 * The desktop shell's own gate.
 *
 * It is the increment's acceptance criteria written as a script: a file opens, a
 * save reaches the disk, a legacy file converts without losing its original, a
 * second process is refused, and a damaged file is recovered rather than
 * replaced. Each is checked against the bytes on disk rather than against the
 * UI's opinion of them.
 */

let box: Sandbox;

test.beforeEach(async () => {
  box = await sandbox();
});

test.afterEach(async () => {
  await box.dispose();
});

test("opens a .canvas file and shows it as the open document", async () => {
  const path = box.documentPath("Research.canvas");
  await writeDocument(path, workspaceEnvelope({ workspaceId: "ws-open", cards: 2 }));

  const run = await launch(box, [path]);
  try {
    await waitForDocument(run.page);

    const info = await openInfo(run.page);
    expect(info).toMatchObject({
      workspaceId: "ws-open",
      path,
      name: "Research.canvas",
      migratedFrom: null,
      recoveredFrom: null,
    });

    // The renderer received a real snapshot, not an empty document.
    const snapshotLength = await run.page.evaluate(async () => {
      const bridge = (globalThis as { suiteDesktop?: { loadDocument(): Promise<unknown> } })
        .suiteDesktop;
      const opened = (await bridge?.loadDocument()) as { snapshot: Uint8Array } | null;
      return opened?.snapshot.byteLength ?? 0;
    });
    expect(snapshotLength).toBeGreaterThan(0);
  } finally {
    await run.close();
  }
});

test("writes the document to the file, and it is still valid after a restart", async () => {
  const path = box.documentPath("Research.canvas");
  await writeDocument(path, workspaceEnvelope({ workspaceId: "ws-save", cards: 1 }));

  const first = await launch(box, [path]);
  try {
    await waitForDocument(first.page);
    // What the app does when the window closes.
    await first.page.evaluate(async () => {
      const bridge = (globalThis as { suiteDesktop?: { flushDocument(): Promise<unknown> } })
        .suiteDesktop;
      await bridge?.flushDocument();
    });
  } finally {
    await first.close();
  }

  expect(readWorkspaceFile(await readDocument(path)).file.workspaceId).toBe("ws-save");

  // Reopening it is the real proof that what was written can be read again.
  const second = await launch(box, [path]);
  try {
    await waitForDocument(second.page);
    expect((await openInfo(second.page))?.workspaceId).toBe("ws-save");
  } finally {
    await second.close();
  }
});

test("converts a legacy .suite file and keeps the original", async () => {
  const legacyPath = box.documentPath("Old.suite");
  await writeDocument(legacyPath, workspaceEnvelope({ workspaceId: "ws-legacy", legacy: true }));

  const run = await launch(box, [legacyPath]);
  try {
    await waitForDocument(run.page);

    const info = await openInfo(run.page);
    expect(info?.migratedFrom).toBe("Old.suite");
    expect(info?.path).toBe(box.documentPath("Old.canvas"));

    const entries = await libraryEntries(box.library);
    expect(entries).toContain("Old.suite");
    expect(entries).toContain("Old.canvas");

    // The new file is the current envelope, and the document came across.
    const converted = readWorkspaceFile(await readDocument(box.documentPath("Old.canvas")));
    expect(converted.file.kind).toBe("suite.canvas");
    expect(converted.workspace.listCards().length).toBeGreaterThan(0);

    // The legacy file is untouched, still calling itself what it was.
    expect(readWorkspaceFile(await readDocument(legacyPath)).file.kind).toBe("suite.workspace");
  } finally {
    await run.close();
  }
});

test("refuses a second process on the same file", async () => {
  const path = box.documentPath("Held.canvas");
  await writeDocument(path, workspaceEnvelope({ workspaceId: "ws-held" }));

  const first = await launch(box, [path]);
  try {
    await waitForDocument(first.page);

    // A second launch must not open the document. It gets its own profile, so
    // Electron's single-instance lock does not answer first and the *file* lock
    // is what the assertion actually exercises.
    const second = await launch(box, [path], { profile: "second" });
    try {
      await waitForBridge(second.page);
      expect(await openInfo(second.page)).toBeNull();
    } finally {
      await second.close();
    }

    // The first process still holds it.
    expect((await openInfo(first.page))?.path).toBe(path);
  } finally {
    await first.close();
  }
});

test("recovers from a backup when the file is damaged, and leaves the file alone", async () => {
  const path = box.documentPath("Broken.canvas");
  const good = workspaceEnvelope({ workspaceId: "ws-broken", cards: 3 });
  await writeDocument(path, good);
  await writeDocument(`${path}.2026-11-03T08-00-00-000Z.bak`, good);
  await truncateDocument(path, 40);

  const run = await launch(box, [path]);
  try {
    await waitForDocument(run.page);

    const info = await openInfo(run.page);
    expect(info?.recoveredFrom).toBe("Broken.canvas.2026-11-03T08-00-00-000Z.bak");

    // The damaged file is not tidied away: it is the only copy of whatever the
    // user had before it broke.
    expect((await readDocument(path)).length).toBe(40);
  } finally {
    await run.close();
  }
});

test("creates a file when a new workspace is started from the launcher", async () => {
  // Started with no file: the shell shows the launcher, which is the same
  // launcher the web build shows. Starting a workspace is the first save, and
  // that save is what puts a document on disk.
  const run = await launch(box, []);
  try {
    await waitForBridge(run.page);
    await expect(run.page.getByTestId("workspace-launcher")).toBeVisible({ timeout: 30_000 });
    expect(await readdir(box.library)).toEqual([]);

    // Creating navigates, and the shell then opens the file it made, so both
    // navigations have to settle before the shell can say what is open.
    // The press navigates immediately, so it is dispatched rather than clicked:
    // a real click would wait for an actionability check on a page that is
    // already unloading.
    await run.page.getByTestId("launcher-new").dispatchEvent("click");
    await run.page.waitForURL(/workspace=/u, { timeout: 30_000 });
    await waitForDocument(run.page);

    const info = await openInfo(run.page);
    expect(info?.path.startsWith(box.library)).toBe(true);
    expect(info?.name.endsWith(".canvas")).toBe(true);
    expect(await readdir(box.library)).toEqual([info?.name]);

    // And it is a document, not just a file: reopening it finds the same id.
    const written = readWorkspaceFile(await readDocument(info?.path ?? ""));
    expect(written.file.workspaceId).toBe(info?.workspaceId);
    expect(written.file.kind).toBe("suite.canvas");
  } finally {
    await run.close();
  }
});
