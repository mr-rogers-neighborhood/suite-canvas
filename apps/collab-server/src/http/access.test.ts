import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLicenceClaimStore, type LicenceClaimStore } from "../store/licenceClaims.js";
import { createWorkspaceOrgStore, type WorkspaceOrgStore } from "../store/workspaceOrgs.js";
import { claimWorkspaceForSession, createWorkspaceAccess, licenceClaimsOf } from "./access.js";
import { HttpError } from "./errors.js";
import { resetRateLimits } from "./rateLimit.js";
import { createSessionFixture, type SessionFixture } from "./sessionFixture.js";

/**
 * The rule every workspace-scoped HTTP route shares: one verified session, one
 * recorded organization, and an entitlement written beside it when it changed.
 */

let directory: string;
let orgs: WorkspaceOrgStore;
let licences: LicenceClaimStore;
let sessions: SessionFixture;

beforeEach(async () => {
  resetRateLimits();
  directory = mkdtempSync(join(tmpdir(), "suite-access-"));
  orgs = createWorkspaceOrgStore(join(directory, "workspaces.sqlite"));
  licences = createLicenceClaimStore(join(directory, "licences.sqlite"));
  sessions = await createSessionFixture();
});

afterEach(() => {
  orgs.close();
  licences.close();
  rmSync(directory, { recursive: true, force: true });
});

/** A request carrying the given bearer token, or none. */
function request(token: string | null): IncomingMessage {
  return {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

describe("licenceClaimsOf", () => {
  it("maps the token's cap names onto the licence's signed fields", async () => {
    const token = await sessions.sign({
      limits: { workspaces: 4, documentBytes: 2048, attachmentBytes: 512 },
    });
    const verified = await sessions.verifier.verify(token);
    if (!verified.ok) throw new Error("expected a verified token");

    expect(licenceClaimsOf(verified.claims, "org-a")).toMatchObject({
      v: 1,
      id: "org-a",
      tier: "team",
      workspaces: 4,
      documentBytes: 2048,
      attachmentBytes: 512,
      expiresAt: verified.claims.expiresAt,
    });
  });

  it("records a missing cap as zero, which adds no budget", async () => {
    const verified = await sessions.verifier.verify(await sessions.sign({ limits: {} }));
    if (!verified.ok) throw new Error("expected a verified token");

    expect(licenceClaimsOf(verified.claims, "org-a")).toMatchObject({
      workspaces: 0,
      documentBytes: 0,
      attachmentBytes: 0,
    });
  });
});

describe("claimWorkspaceForSession", () => {
  it("records the organization and the entitlement on the first claim", async () => {
    const verified = await sessions.verifier.verify(await sessions.sign());
    if (!verified.ok) throw new Error("expected a verified token");

    const outcome = claimWorkspaceForSession({ orgs, licences }, "ws-1", verified.claims);

    expect(outcome).toBe("claimed");
    expect(orgs.get("ws-1")?.organizationId).toBe("org-a");
    expect(licences.get("ws-1")).toMatchObject({ licenceId: "org-a", tier: "team" });
  });

  it("does not rewrite an entitlement a reconnect did not change", async () => {
    const token = await sessions.sign();
    const first = await sessions.verifier.verify(token);
    const second = await sessions.verifier.verify(token);
    if (!first.ok || !second.ok) throw new Error("expected verified tokens");

    claimWorkspaceForSession({ orgs, licences }, "ws-1", first.claims);
    const record = vi.spyOn(licences, "record");
    claimWorkspaceForSession({ orgs, licences }, "ws-1", second.claims);

    expect(record).not.toHaveBeenCalled();
    record.mockRestore();
  });

  it("refuses another organization and writes nothing", async () => {
    const owned = await sessions.verifier.verify(await sessions.sign());
    const other = await sessions.verifier.verify(
      await sessions.sign({ organizationId: "org-b", subject: "user-2" }),
    );
    if (!owned.ok || !other.ok) throw new Error("expected verified tokens");

    claimWorkspaceForSession({ orgs, licences }, "ws-1", owned.claims);
    const outcome = claimWorkspaceForSession({ orgs, licences }, "ws-1", other.claims);

    expect(outcome).toBe("conflict");
    expect(orgs.get("ws-1")?.organizationId).toBe("org-a");
    expect(licences.get("ws-1")?.licenceId).toBe("org-a");
  });

  it("has nothing to record for a session with no organization", async () => {
    const verified = await sessions.verifier.verify(
      await sessions.sign({ organizationId: null, role: null }),
    );
    if (!verified.ok) throw new Error("expected a verified token");

    expect(claimWorkspaceForSession({ orgs, licences }, "ws-1", verified.claims)).toBe(
      "organization-required",
    );
    expect(orgs.has("ws-1")).toBe(false);
  });

  it("allows a free tier organization to claim and sync a workspace", async () => {
    // A fresh organization on the free tier can claim and sync workspaces.
    const verified = await sessions.verifier.verify(
      await sessions.sign({ tier: "free", limits: {} }),
    );
    if (!verified.ok) throw new Error("expected a verified token");

    const outcome = claimWorkspaceForSession({ orgs, licences }, "ws-1", verified.claims);

    expect(outcome).toBe("claimed");
    expect(orgs.has("ws-1")).toBe(true);
    expect(licences.get("ws-1")?.tier).toBe("free");
  });

  it("refuses a workspace when explicit ceiling is 0, and writes nothing", async () => {
    const verified = await sessions.verifier.verify(
      await sessions.sign({ tier: "unlicensed", limits: { workspaces: 0 } }),
    );
    if (!verified.ok) throw new Error("expected a verified token");

    const outcome = claimWorkspaceForSession({ orgs, licences }, "ws-1", verified.claims);

    expect(outcome).toBe("plan-required");
    expect(orgs.has("ws-1")).toBe(false);
    expect(licences.get("ws-1")).toBeNull();
  });

  it("keeps a workspace the organization already holds, whatever the plan says now", async () => {
    const paid = await sessions.verifier.verify(await sessions.sign());
    const lapsed = await sessions.verifier.verify(
      await sessions.sign({ tier: "free", limits: {} }),
    );
    if (!paid.ok || !lapsed.ok) throw new Error("expected verified tokens");

    claimWorkspaceForSession({ orgs, licences }, "ws-1", paid.claims);
    // A licence that shrank ends new work; it does not take documents away.
    expect(claimWorkspaceForSession({ orgs, licences }, "ws-1", lapsed.claims)).toBe("owned");
  });

  it("refuses another workspace once the organization is at its ceiling", async () => {
    const verified = await sessions.verifier.verify(
      await sessions.sign({ limits: { workspaces: 1 } }),
    );
    if (!verified.ok) throw new Error("expected a verified token");

    claimWorkspaceForSession({ orgs, licences }, "ws-1", verified.claims);
    const outcome = claimWorkspaceForSession({ orgs, licences }, "ws-2", verified.claims);

    expect(outcome).toBe("workspace-limit");
    expect(orgs.has("ws-2")).toBe(false);
  });

  it("records nothing when the deployment keeps no entitlement rows", async () => {
    const verified = await sessions.verifier.verify(await sessions.sign());
    if (!verified.ok) throw new Error("expected a verified token");

    expect(claimWorkspaceForSession({ orgs, licences: null }, "ws-1", verified.claims)).toBe(
      "claimed",
    );
    expect(orgs.has("ws-1")).toBe(true);
  });
});

describe("createWorkspaceAccess", () => {
  it("answers 401 without a session and with one that does not verify", async () => {
    const access = createWorkspaceAccess({ sessions: sessions.verifier, orgs });

    await expect(access.forWorkspace(request(null), "ws-1")).rejects.toBeInstanceOf(HttpError);
    await expect(access.forWorkspace(request("not-a-token"), "ws-1")).rejects.toMatchObject({
      problem: { message: "Your session is no longer valid. Sign in again." },
    });
    await expect(
      access.forWorkspace(request(await sessions.sign({ expiresInSeconds: -60 })), "ws-1"),
    ).rejects.toBeInstanceOf(HttpError);
    expect(orgs.has("ws-1")).toBe(false);
  });

  it("returns the account principal for the organization that owns the workspace", async () => {
    const access = createWorkspaceAccess({ sessions: sessions.verifier, orgs, licences });

    const principal = await access.forWorkspace(request(await sessions.sign()), "ws-1");

    expect(principal).toMatchObject({
      kind: "account",
      workspaceId: "ws-1",
      organizationId: "org-a",
      userId: "user-1",
      role: "member",
      tier: "team",
    });
    expect(orgs.get("ws-1")?.organizationId).toBe("org-a");
  });

  it("writes nothing at all when the credential does not verify", async () => {
    const access = createWorkspaceAccess({ sessions: sessions.verifier, orgs, licences });

    await expect(
      access.forWorkspace(request(await sessions.sign({ foreignKey: true })), "ws-1"),
    ).rejects.toBeInstanceOf(HttpError);
    await expect(
      access.forWorkspace(
        request(await sessions.sign({ organizationId: null, role: null })),
        "ws-1",
      ),
    ).rejects.toMatchObject({
      problem: { message: "This session is not acting in an organization." },
    });

    expect(orgs.has("ws-1")).toBe(false);
    expect(licences.get("ws-1")).toBeNull();
  });
});
