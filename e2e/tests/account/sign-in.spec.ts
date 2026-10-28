import { expect, test } from "@playwright/test";
import { hostedUrl } from "../fixtures/account";
import { cardByTitle, cards, createNote, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-sign-in");

/**
 * The account surface on a deployment that has an account service.
 *
 * The suite runs the real control plane (`scripts/control-plane.mjs`), so
 * `/api/auth/ok` answers `{ ok: true }` on the hosted origin and the app's own
 * bootstrap runs for real. A browser with no session is left alone: no identity
 * is created for it, the board is local, and the status control says so.
 *
 * The pending-account case still has no server of its own, so it stays stubbed at
 * the network boundary on the plain dev origin: `/api/auth/ok` answers `ok`, the
 * session reports `admittedAt: null`, and the admission-gated call that creating
 * an account's first organization needs is refused with `admission-pending`,
 * exactly as `services/auth` refuses it. What is under test is our surface, not
 * Better Auth.
 */

const dialog = (page: import("@playwright/test").Page) => page.getByTestId("sign-in-dialog");

test("a deployment with accounts leaves a browser with no session local", {
  tag: "@smoke",
}, async ({ page }) => {
  // Deliberately no storage state: a first visit is the case under test.
  await page.goto(hostedUrl(`/?workspace=${id("no-session")}`));
  await expect(cards(page)).toHaveCount(2);

  // No session is created, so the header offers the sign-in entry rather than an
  // account chip. The relay never saw this browser, so nothing was refused.
  await expect(page.getByTestId("sign-in-entry")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("account-chip")).toHaveCount(0);

  const status = page.getByTestId("sync-status");
  // The pill says what the copy does, not who the reader is: "Saved" is the rung for a
  // workspace that exists on this device and nowhere else. `TitleBar.test.tsx` pins the
  // same pair (`unauthorized` + `signed-out` reads `Saved`), which is where this
  // expectation drifted from.
  await expect(status).toHaveText("Saved");
  await status.click();
  // The panel names where the work is rather than what it is not: "Saved on this
  // device" is `storageLadder`'s rung for a copy that exists here and nowhere else.
  await expect(page.getByTestId("sync-room")).toContainText("Saved on this device");
  await expect(page.getByTestId("sync-room")).not.toContainText(/refused/i);
  // The storage surface is the panel's own "what does this device hold" block, one
  // press further in: the panel leads with who else is here and discloses the rest.
  await expect(page.getByTestId("storage-status")).toHaveCount(0);
  await page.getByTestId("sync-details").click();
  await expect(page.getByTestId("storage-status")).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);

  // The workspace never left this browser: local editing is the same as it was
  // before accounts existed.
  await createNote(page, "Local note");
  await expect(cardByTitle(page, "Local note")).toHaveCount(1);
});

test("an account that is not admitted still edits locally", { tag: "@smoke" }, async ({ page }) => {
  // A held account (`admittedAt: null`) is a server fact, so it is the one thing
  // stubbed here. Nothing in this build calls a gated route from boot: the
  // admission panel opens when a claim or an organization is refused, and the
  // component test (`AdmissionPanel.test.tsx`) is what proves that surface. What
  // this spec keeps is the promise underneath it — a held account is not a wall.
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/ok")) {
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }
    if (path.endsWith("/get-session")) {
      await route.fulfill({
        status: 200,
        json: {
          session: { id: "session-1", userId: "user-1", expiresAt: Date.now() + 3_600_000 },
          user: { id: "user-1", email: "held@example.com", admittedAt: null },
        },
      });
      return;
    }
    if (path.endsWith("/organization/list")) {
      await route.fulfill({ status: 200, json: [] });
      return;
    }
    await route.fulfill({ status: 404, json: { code: "not-found" } });
  });

  await page.goto(`/?workspace=${id("pending")}`);
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByTestId("account-chip")).toHaveAttribute("title", "held@example.com", {
    timeout: 20_000,
  });

  // The workspace never asked who this is.
  await createNote(page, "Still editable");
  await expect(cardByTitle(page, "Still editable")).toHaveCount(1);
});
