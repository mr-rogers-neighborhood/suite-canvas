import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, type Request, test } from "@playwright/test";
import { cardByTitle, cards, createNote } from "./support";

/**
 * The attachment round trip, which is the product's trust path: a `.suite`
 * export is the user's only backup, so an image that survives as a node but
 * loses its bytes is the exact failure these tests exist to catch.
 *
 * The paste is driven the way a browser delivers one — a `ClipboardEvent` with
 * a `DataTransfer` holding a real PNG — so the editor's own `handlePaste` runs.
 */

let sequence = 0;

/** An 8x8 RGBA PNG. Real bytes: the browser decodes it and reports 8x8. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAoElEQVR42g3K0QAEMQxF0SAMQhAGIQhFeAhFCEIRgjAIQViEmNzt+T5mZrg9hDmyl7SgbNEmxjZm/uDuhL/Ig/RFuWjfjOcN4Xi8RASKRYao2HQkE+cGvbiC0EISqU0paR1GdUMGnotIodxkJpWHzmLyu6EWXiJqo0qyDlVF18dU39DCexOdqA/ZRfVHdzP9u2E2PknMQVPkfNQ0PT9mhj/jRpPBG+li2wAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");
const PNG_WIDTH = 8;

interface BackupAttachment {
  mime: string;
  name: string;
  width: number | null;
  height: number | null;
  data: string;
}

interface BackupFile {
  kind: string;
  version: number;
  manifest: { boards: number; cards: number; types: number; tags: number };
  attachments: Record<string, BackupAttachment>;
}

interface Backup {
  filename: string;
  path: string;
  file: BackupFile;
}

/**
 * Fits the viewport to the board. React Flow only mounts nodes inside the
 * viewport, so a projection can hold every card while the DOM shows fewer;
 * counting nodes without fitting makes the assertion depend on scroll position.
 */
async function fitView(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Fit View" }).first().click();
  await page.waitForTimeout(400);
}

/**
 * Waits until exactly `count` cards are mounted. The projection arrives
 * asynchronously, and a fit performed before it lands frames an empty board, so
 * the view is re-fitted until the expected cards are all in the viewport.
 */
async function expectCardsMounted(page: Page, count: number): Promise<void> {
  await expect
    .poll(
      async () => {
        await fitView(page);
        return cards(page).count();
      },
      { timeout: 20_000, intervals: [500, 1_000, 1_500] },
    )
    .toBe(count);
}

/** Opens a fresh workspace with an owner key this test knows, so it can delete relay rows. */
async function openWorkspace(page: Page, name: string): Promise<{ id: string; ownerKey: string }> {
  const id = `e2e-attachment-${name}-${Date.now()}-${++sequence}`;
  const ownerKey = crypto.randomUUID();
  await page.goto(`/?workspace=${id}#owner=${ownerKey}`);
  // A fresh workspace is seeded with two starter cards.
  await expectCardsMounted(page, 2);
  return { id, ownerKey };
}

/**
 * Delivers an image paste to the focused card body exactly as the browser does:
 * a cancelable `clipboardData` carrying one file. The editor's `PasteImages`
 * plugin claims the paste and inserts the node once the bytes are stored.
 */
async function pastePng(page: Page, card: Locator): Promise<void> {
  await card.getByTestId("card-body").dblclick();
  await expect(page.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(1);
  // React StrictMode remounts the editor once in dev; let the focused instance
  // settle so the paste cannot land in the discarded one.
  await page.waitForTimeout(250);
  await page.evaluate((base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    const target =
      document.querySelector(".node-card-editor.ProseMirror-focused") ??
      document.querySelector(".node-card-editor");
    if (target === null) throw new Error("the card body editor is not mounted");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
  }, PNG_BASE64);
}

/** A rendered image, with real decoded pixels — not a placeholder and not a broken `<img>`. */
async function expectImageRendered(card: Locator): Promise<void> {
  await expect(card.locator("img.attachment-image")).toHaveCount(1);
  await expect
    .poll(
      async () =>
        card
          .locator("img.attachment-image")
          .evaluate((node) => (node as HTMLImageElement).naturalWidth),
      { timeout: 15_000 },
    )
    .toBe(PNG_WIDTH);
  await expect(card.locator(".attachment-placeholder")).toHaveCount(0);
}

/** File -> Export backup, and the file that landed on disk. */
async function exportBackup(page: Page): Promise<Backup> {
  await page.getByTestId("workspace-file").click();
  const pending = page.waitForEvent("download");
  await page.getByTestId("workspace-export-backup").click();
  const download = await pending;
  const path = await download.path();
  if (path === null) throw new Error("the backup download has no path");
  const text = await readFile(path, "utf8");
  return {
    filename: download.suggestedFilename(),
    path,
    file: JSON.parse(text) as BackupFile,
  };
}

const postedAttachment = (page: Page) =>
  page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/api/attachments/"),
    { timeout: 15_000 },
  );

/** The node id the paste sends with its upload; the node and the relay row share it. */
function attachmentIdOf(request: Request): string {
  const value = request.headers()["x-suite-attachment-id"];
  if (value === undefined) throw new Error("the upload carried no x-suite-attachment-id");
  return value;
}

/** Resolves once the relay answers that upload; `undefined` if it never answers. */
const attachmentUploadResponse = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes("/api/attachments/"),
    { timeout: 15_000 },
  );

/** Removes this browser's copy of one id from the local byte store. */
async function deleteLocalAttachment(page: Page, id: string): Promise<void> {
  await page.evaluate(async (attachmentId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("suite-attachments", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("could not open IndexedDB"));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("bytes", "readwrite");
        transaction.objectStore("bytes").delete(attachmentId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("could not delete"));
      });
    } finally {
      database.close();
    }
  }, id);
}

/** The decoded length of the locally stored copy, or null when there is none. */
async function localAttachmentLength(page: Page, id: string): Promise<number | null> {
  return page.evaluate(async (attachmentId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("suite-attachments", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("could not open IndexedDB"));
    });
    try {
      const record = await new Promise<{ bytes: Uint8Array } | undefined>((resolve, reject) => {
        const transaction = database.transaction("bytes", "readonly");
        const request = transaction.objectStore("bytes").get(attachmentId);
        request.onsuccess = () => resolve(request.result as { bytes: Uint8Array } | undefined);
        request.onerror = () => reject(request.error ?? new Error("could not read"));
      });
      return record ? record.bytes.byteLength : null;
    } finally {
      database.close();
    }
  }, id);
}

test("a pasted image survives export, a storage wipe and import", async ({
  page,
  context,
  request,
}) => {
  const { id: workspaceId, ownerKey } = await openWorkspace(page, "roundtrip");
  await createNote(page, "Attachment card");
  await expectCardsMounted(page, 3);
  const card = cardByTitle(page, "Attachment card");

  const uploadPending = postedAttachment(page);
  const uploadResponsePending = attachmentUploadResponse(page);
  await pastePng(page, card);
  const upload = await uploadPending;
  const nodeId = attachmentIdOf(upload);
  expect(nodeId).toMatch(/^[0-9a-f]{32}$/u);
  // The paid path uploads under the node's own id, so the relay row and the
  // node are the same attachment.
  expect((await uploadResponsePending).status()).toBe(201);

  await expectImageRendered(card);
  await page.keyboard.press("Escape");
  await expect(page.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(0);

  const backup = await exportBackup(page);
  expect(backup.filename).toMatch(/\.suite$/u);
  expect(backup.file.kind).toBe("suite.workspace");
  expect(backup.file.version).toBeGreaterThanOrEqual(2);
  const embedded = backup.file.attachments[nodeId];
  expect(embedded).toBeDefined();
  if (embedded === undefined) throw new Error(`the backup has no bytes for ${nodeId}`);
  expect(embedded.mime).toBe("image/png");
  expect(embedded.name).toBe("pasted.png");
  expect(embedded.width).toBe(PNG_WIDTH);
  expect(embedded.height).toBe(PNG_WIDTH);
  expect(embedded.data.length).toBeGreaterThan(0);
  // Byte-for-byte, not merely non-empty.
  expect(Buffer.from(embedded.data, "base64").equals(PNG_BYTES)).toBe(true);
  // The manifest counts the document the same way the board does.
  expect(backup.file.manifest.cards).toBe(3);
  expect(backup.file.manifest.boards).toBe(1);

  // Wipe this browser completely: IndexedDB (the local byte store and the
  // cached document) and localStorage. Anything that survives below came from
  // the file, not from a copy of this browser's own.
  //
  // The relay's row goes too. Without that, a node whose bytes the file failed
  // to carry would still draw here by re-fetching the id from the relay, which
  // is exactly the "bytes did not survive" failure this test is about.
  const removal = await request.delete(`http://localhost:1235/api/attachments/${nodeId}`, {
    headers: { authorization: `Bearer ${ownerKey}` },
  });
  expect(removal.status()).toBe(200);

  // Leave the workspace first — a live editor writes its owner key and recents
  // back on unload, which would undo a wipe done underneath it.
  await page.goto("/");
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Storage.clearDataForOrigin", {
    origin: new URL(page.url()).origin,
    storageTypes: "indexeddb,local_storage",
  });
  // The relay marks attachment reads `immutable` for a year, so the browser
  // would otherwise keep serving the deleted image from its own cache.
  await cdp.send("Network.clearBrowserCache");
  await cdp.detach();
  await page.goto("/");
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();

  const remaining = await page.evaluate(async () => {
    const databases = (await indexedDB.databases()).map((database) => database.name ?? "");
    const open = (name: string) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("could not open IndexedDB"));
      });
    let snapshots: string[] = [];
    let updates = 0;
    if (databases.includes("suite-loro")) {
      const database = await open("suite-loro");
      try {
        snapshots = await new Promise<string[]>((resolve, reject) => {
          const request = database
            .transaction("snapshots", "readonly")
            .objectStore("snapshots")
            .getAllKeys();
          request.onsuccess = () => resolve(request.result as string[]);
          request.onerror = () => reject(request.error ?? new Error("could not list snapshots"));
        });
        updates = await new Promise<number>((resolve, reject) => {
          const request = database
            .transaction("updates", "readonly")
            .objectStore("updates")
            .count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error("could not count updates"));
        });
      } finally {
        database.close();
      }
    }
    return { localStorageKeys: Object.keys(window.localStorage), databases, snapshots, updates };
  });
  expect(remaining.databases).not.toContain("suite-attachments");
  // The launcher itself opens an empty `suite-loro`; what matters is that no
  // row of this workspace's document survived.
  expect(remaining.snapshots).not.toContain(workspaceId);
  expect(remaining.updates).toBe(0);
  expect(remaining.localStorageKeys).not.toContain(`suite.owner.${workspaceId}`);
  expect(remaining.localStorageKeys).not.toContain(`suite.owner-claim.${workspaceId}`);

  await page.getByTestId("launcher-file").setInputFiles(backup.path);
  await expect(page).toHaveURL(/workspace=/u);
  await expectCardsMounted(page, 3);

  // The node arriving is not enough: the bytes must arrive with it.
  const imported = cardByTitle(page, "Attachment card");
  await expect(imported).toHaveCount(1);
  await expectImageRendered(imported);
});

test("a paste with an unreachable relay keeps its bytes locally and exports them", async ({
  page,
}) => {
  // The local-first half of the standalone claim: no attachment route answers,
  // exactly as a build with no relay, so the paste falls back to IndexedDB.
  const relayRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/attachments/")) {
      relayRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.route("**/api/attachments/**", (route) => route.abort("internetdisconnected"));

  await openWorkspace(page, "local-first");
  await createNote(page, "Offline image");
  await expectCardsMounted(page, 3);
  const card = cardByTitle(page, "Offline image");

  const attemptPending = postedAttachment(page);
  await pastePng(page, card);
  const nodeId = attachmentIdOf(await attemptPending);
  expect(nodeId).toMatch(/^[0-9a-f]{32}$/u);

  // Rendering at all here means the bytes are in this browser: the relay route
  // is aborted, so no `<img>` could have loaded one from it.
  await expectImageRendered(card);
  expect(await localAttachmentLength(page, nodeId)).toBe(PNG_BYTES.byteLength);
  await page.keyboard.press("Escape");
  await expect(page.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(0);

  const backup = await exportBackup(page);
  const embedded = backup.file.attachments[nodeId];
  expect(embedded).toBeDefined();
  if (embedded === undefined) throw new Error(`the backup has no bytes for ${nodeId}`);
  expect(Buffer.from(embedded.data, "base64").equals(PNG_BYTES)).toBe(true);
  // Local first: the export never asked the relay for bytes it already held.
  expect(relayRequests.filter((entry) => entry.startsWith("GET "))).toEqual([]);
});

test("an image whose bytes are gone is named in the warning and the export still downloads", async ({
  page,
  context,
  request,
}) => {
  const { ownerKey } = await openWorkspace(page, "missing");
  await createNote(page, "Ghost image");
  await expectCardsMounted(page, 3);
  const card = cardByTitle(page, "Ghost image");

  const uploadPending = postedAttachment(page);
  const uploadResponsePending = attachmentUploadResponse(page);
  await pastePng(page, card);
  const nodeId = attachmentIdOf(await uploadPending);
  expect(nodeId).toMatch(/^[0-9a-f]{32}$/u);
  // The relay must hold the row before the test can delete it.
  expect((await uploadResponsePending).status()).toBe(201);
  await expectImageRendered(card);
  await page.keyboard.press("Escape");
  await expect(page.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(0);

  // The exact data-loss case: the node stays in the document, its bytes are
  // gone from both places an export can look.
  await deleteLocalAttachment(page, nodeId);
  const removal = await request.delete(`http://localhost:1235/api/attachments/${nodeId}`, {
    headers: { authorization: `Bearer ${ownerKey}` },
  });
  expect(removal.status()).toBe(200);
  // The relay marks attachment reads `immutable` for a year, so a browser that
  // already fetched the image would still serve it from cache. Drop that copy:
  // the export must ask the relay and be told the bytes are gone.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.clearBrowserCache");
  await cdp.detach();

  // The export path deliberately avoids `confirm`; a dialog would be a way for
  // the backup to be cancelled, which is worse than a large or incomplete one.
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.evaluate(() => {
    const calls: string[] = [];
    (window as unknown as { __suiteDialogs: string[] }).__suiteDialogs = calls;
    window.confirm = (message?: string) => {
      calls.push(`confirm:${message ?? ""}`);
      return false;
    };
    window.alert = (message?: string) => {
      calls.push(`alert:${message ?? ""}`);
    };
    window.prompt = (message?: string) => {
      calls.push(`prompt:${message ?? ""}`);
      return null;
    };
  });

  const backup = await exportBackup(page);
  expect(backup.filename).toMatch(/\.suite$/u);
  // The document still exported; the bytes could not.
  expect(Object.keys(backup.file.attachments)).toEqual([]);
  expect(backup.file.manifest.cards).toBe(3);

  const notice = page.getByTestId("workspace-export-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("1 image is missing from this backup");
  // The card title, for a human, and what will be on screen.
  await expect(notice).toContainText("Ghost image");
  await expect(notice).toContainText("placeholder");

  expect(dialogs).toEqual([]);
  const inPage = await page.evaluate(
    () => (window as unknown as { __suiteDialogs: string[] }).__suiteDialogs,
  );
  expect(inPage).toEqual([]);
});

test("the size warning is reachable at the threshold", async ({ page }) => {
  // The app exposes no runtime seam for BACKUP_SIZE_WARNING_BYTES, so this
  // stubs the dev-served module's threshold to 1 KiB. The copy under test is
  // the real one; only the number that makes it reachable is changed.
  let stubbed = false;
  await page.route("**/src/session/workspaceTransfer.ts*", async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    const body = original.replace("25 * 1024 * 1024", "1024");
    stubbed = body !== original;
    await route.fulfill({ response, body });
  });

  await openWorkspace(page, "size-warning");
  await createNote(page, "Big backup");
  expect(stubbed).toBe(true);

  const backup = await exportBackup(page);
  expect(backup.filename).toMatch(/\.suite$/u);

  const notice = page.getByTestId("workspace-export-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("with its images");
  await expect(notice).toContainText("every image is included");
});
