import { expect, test } from "@playwright/test";
import { hostedUrl } from "../fixtures/account";
import { cardByTitle, cards, createNote, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-sign-in");

/**
 * The account surface on a deployment that has an account service.
 *
 * The suite runs the real control plane (`scripts/control-plane.mjs`), so
 * `/api/auth/ok` answers `{ ok: true }` on the hosted origin and the app's own
 * bootstrap runs for real: a browser with no session is given an anonymous one
 * (ADR-0077), which is what makes "sign up later and keep this work" true. The
 * old version of this spec asserted the opposite — a 404 from the bare dev server
 * — which is now only one of the deployment shapes the suite covers, and not the
 * one an account spec should be measuring.
 *
 * The pending-account case still has no server of its own, so it stays stubbed at
 * the network boundary on the plain dev origin: `/api/auth/ok` answers `ok`, the
 * session reports `admittedAt: null`, and the admission-gated call that creating
 * an account's first organization needs is refused with `admission-pending`,
 * exactly as `services/auth` refuses it. What is under test is our surface, not
 * Better Auth.
 */

const dialog = (page: import("@playwright/test").Page) => page.getByTestId("sign-in-dialog");

test("a deployment with accounts gives the browser an anonymous session", {
  tag: "@smoke",
}, async ({ page }) => {
  // Deliberately no storage state: a first visit is the case under test.
  await page.goto(hostedUrl(`/?workspace=${id("anonymous-session")}`));
  await expect(cards(page)).toHaveCount(2);

  // The bootstrap probes, finds no session and mints an anonymous one, so the
  // header offers the account rather than a Sign in button nobody needs.
  const chip = page.getByTestId("account-chip");
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("sign-in-entry")).toHaveCount(0);

  await chip.click();
  await expect(page.getByTestId("account-menu")).toBeVisible();
  await page.getByTestId("account-menu-account").click();
  await expect(page.getByTestId("account-panel")).toBeVisible();
  // The anonymous row has a real address the server minted; it is not a guess by
  // the client, which is the point of reading it back from the session.
  await expect(page.getByTestId("account-email")).not.toBeEmpty();
  await page.getByTestId("account-panel-close").click();
  await expect(page.getByTestId("account-panel")).toHaveCount(0);

  // The session never had the workspace: local editing is the same as it was
  // before accounts existed.
  await createNote(page, "Local note");
  await expect(cardByTitle(page, "Local note")).toHaveCount(1);
  await page.getByTestId("sync-status").click();
  await expect(page.getByTestId("storage-status")).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
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
