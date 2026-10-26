import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminPaths } from "../ops/admin.js";
import { type AttachmentStore, createSqliteAttachmentStore } from "../store/attachments.js";
import { createLicenceClaimStore, type LicenceClaimStore } from "../store/licenceClaims.js";
import { createDocumentStore } from "../store/persistence.js";
import { createShareStore } from "../store/shares.js";
import { createWorkspaceOrgStore, type WorkspaceOrgStore } from "../store/workspaceOrgs.js";
import { createWorkspaceAccess } from "./access.js";
import { resetRateLimits } from "./rateLimit.js";
import { createSessionFixture, type SessionFixture } from "./sessionFixture.js";
import { handleWorkspaceRequest } from "./workspaceHttp.js";

/**
 * The one workspace route left (ADR-0076): the account's own delete.
 *
 * Claim, rotate and status are gone with the owner key, so this file also pins
 * that they answer 404 rather than lingering as a second credential path.
 */

let directory: string;
let orgs: WorkspaceOrgStore;
let licenceClaims: LicenceClaimStore;
let documents: ReturnType<typeof createDocumentStore>;
let shares: ReturnType<typeof createShareStore>;
let attachments: AttachmentStore;
let sessions: SessionFixture;
let server: Server;
let baseUrl: string;
let paths: AdminPaths;
let deletions: string[];
/** The service credential the control plane presents, and how often the session path was asked. */
const PURGE_TOKEN = "purge-token-for-tests";
let sessionChecks: string[];

beforeEach(async () => {
  resetRateLimits();
  deletions = [];
  sessionChecks = [];
  directory = mkdtempSync(join(tmpdir(), "suite-workspace-api-"));
  // Every store is file-backed: the account delete runs the operator CLI's
  // implementation, which edits the files named here.
  paths = {
    workspaces: join(directory, "workspaces.sqlite"),
    documents: join(directory, "documents.sqlite"),
    shares: join(directory, "shares.sqlite"),
  };
  orgs = createWorkspaceOrgStore(paths.workspaces);
  licenceClaims = createLicenceClaimStore(join(directory, "licences.sqlite"));
  documents = createDocumentStore(paths.documents);
  shares = createShareStore(paths.shares);
  // The same store the attachment route serves from: an erasure that left the
  // bytes behind would be a delete in name only.
  attachments = createSqliteAttachmentStore(join(directory, "attachments.sqlite"));
  sessions = await createSessionFixture();
  const real = createWorkspaceAccess({
    sessions: sessions.verifier,
    orgs,
    licences: licenceClaims,
  });
  const access = {
    session: real.session,
    forWorkspace: (request: Parameters<typeof real.forWorkspace>[0], workspaceId: string) => {
      sessionChecks.push(workspaceId);
      return real.forWorkspace(request, workspaceId);
    },
  };

  server = createServer((request, response) => {
    void handleWorkspaceRequest(request, response, {
      access,
      licences: licenceClaims,
      attachments,
      purgeToken: PURGE_TOKEN,
      exists: (workspaceId) =>
        documents.load(`%LOR:${workspaceId}`) !== null || shares.list(workspaceId).length > 0,
      forgetWorkspace: (workspaceId) => {
        orgs.remove(workspaceId);
      },
      onDeleted: (workspaceId) => {
        deletions.push(workspaceId);
      },
      storage: paths,
    }).then((handled) => {
      if (handled) return;
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  orgs.close();
  licenceClaims.close();
  documents.close();
  shares.close();
  attachments.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(
  id: string,
  overrides: Parameters<SessionFixture["sign"]>[0] = {},
): Promise<string> {
  return sessions.sign({ organizationId: "org-a", subject: `user-${id}`, ...overrides });
}

async function deleteRequest(
  workspaceId: string,
  token: string | null,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function seedWorkspace(): { token: string; shareId: string } {
  documents.save("%LOR:ws-1", new TextEncoder().encode("workspace one"));
  const created = shares.create({
    workspaceId: "ws-1",
    scope: "board",
    role: "viewer",
    boardId: "board-1",
  });
  shares.setBaseline(created.share.id, new Uint8Array([1, 2, 3]));
  documents.save(`%LOR:share-${created.token}`, new TextEncoder().encode("projected board"));
  attachments.put("ws-1", new Uint8Array([1, 2, 3, 4]), "image/png");
  // The delete route removes rows through its own connection, so the fixture has
  // to be on disk the way `sync/server.ts` makes it before a delete.
  documents.flush();
  return { token: created.token, shareId: created.share.id };
}

describe("workspace delete API", () => {
  it("lets the owning account delete the workspace and everything stored beside it", async () => {
    orgs.claim("ws-1", "org-a");
    const token = await session("1");
    const seeded = seedWorkspace();
    licenceClaims.record(
      "ws-1",
      {
        v: 1,
        id: "org-a",
        tier: "team",
        workspaces: 25,
        documentBytes: 1024,
        attachmentBytes: 1024,
        issuedAt: Date.now() - 1000,
        expiresAt: Date.now() + 60_000,
      },
      Date.now(),
    );

    const response = await deleteRequest("ws-1", token, { confirm: "ws-1" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.deleted).toBe(true);
    expect(body.organizationId).toBe("org-a");
    expect(body.orgRows).toBe(1);
    expect(body.shares).toBe(1);
    expect(body.baselines).toBe(1);
    expect(body.documents).toBe(1);
    expect(body.projected).toBe(1);
    expect(body.licenceRows).toBe(1);

    expect(orgs.has("ws-1")).toBe(false);
    expect(documents.load("%LOR:ws-1")).toBeNull();
    expect(documents.load(`%LOR:share-${seeded.token}`)).toBeNull();
    expect(shares.list("ws-1")).toEqual([]);
    expect(shares.getBaseline(seeded.shareId)).toBeNull();
    expect(licenceClaims.get("ws-1")).toBeNull();
    // The hook a host uses to close live sessions sees the committed delete.
    expect(deletions).toEqual(["ws-1"]);
  });

  it("refuses a session from another organization", async () => {
    orgs.claim("ws-1", "org-a");
    seedWorkspace();

    const denied = await deleteRequest("ws-1", await session("2", { organizationId: "org-b" }), {
      confirm: "ws-1",
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: "This workspace belongs to a different organization.",
    });
    expect(orgs.has("ws-1")).toBe(true);
    expect(documents.load("%LOR:ws-1")).not.toBeNull();
    expect(deletions).toEqual([]);
  });

  it("requires the workspace id in the body", async () => {
    orgs.claim("ws-1", "org-a");
    seedWorkspace();
    const token = await session("1");

    const mismatch = await deleteRequest("ws-1", token, { confirm: "ws-2" });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({
      error: 'Deleting a workspace requires {"confirm":"ws-1"} in the request body.',
    });

    const missing = await deleteRequest("ws-1", token, {});
    expect(missing.status).toBe(400);

    expect(documents.load("%LOR:ws-1")).not.toBeNull();
  });

  it("answers 404 for a workspace the relay does not know", async () => {
    const unknown = await deleteRequest("ws-missing", await session("1"), {
      confirm: "ws-missing",
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Workspace not found." });
  });

  it("requires a session at all", async () => {
    orgs.claim("ws-1", "org-a");
    const anonymous = await deleteRequest("ws-1", null, { confirm: "ws-1" });
    expect(anonymous.status).toBe(401);
    expect(orgs.has("ws-1")).toBe(true);
  });

  it("refuses an expired session", async () => {
    orgs.claim("ws-1", "org-a");
    const expired = await deleteRequest("ws-1", await session("1", { expiresInSeconds: -60 }), {
      confirm: "ws-1",
    });
    expect(expired.status).toBe(401);
    expect(orgs.has("ws-1")).toBe(true);
  });

  it("is rate limited, because a delete is a destructive operation", async () => {
    const token = await session("1");
    for (let index = 0; index < 10; index += 1) {
      const response = await deleteRequest(`ws-limit-${index}`, token, {
        confirm: `ws-limit-${index}`,
      });
      expect(response.status).toBe(404);
    }
    const limited = await deleteRequest("ws-limit-final", token, { confirm: "ws-limit-final" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("does not let a share token delete the workspace", async () => {
    orgs.claim("ws-1", "org-a");
    const seeded = seedWorkspace();

    const response = await deleteRequest("ws-1", seeded.token, { confirm: "ws-1" });
    expect(response.status).toBe(401);
    expect(orgs.has("ws-1")).toBe(true);
    expect(shares.list("ws-1")).toHaveLength(1);
  });
});

describe("the control plane's purge credential", () => {
  /** A delete as the control plane sends it: the token, and the id repeated in the body. */
  function purge(workspaceId: string, token: string | null = PURGE_TOKEN): Promise<Response> {
    return deleteRequest(workspaceId, token, { confirm: workspaceId });
  }

  it("purges a workspace without a session and reports every count", async () => {
    orgs.claim("ws-1", "org-a");
    const seeded = seedWorkspace();

    const response = await purge("ws-1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // The account's own delete reports these same six numbers; a service call
    // differs only in that it has no organization to name.
    expect(body).toMatchObject({
      workspaceId: "ws-1",
      deleted: true,
      organizationId: null,
      documents: 1,
      projected: 1,
      shares: 1,
      baselines: 1,
      attachments: 1,
    });

    expect(orgs.has("ws-1")).toBe(false);
    expect(documents.load("%LOR:ws-1")).toBeNull();
    expect(documents.load(`%LOR:share-${seeded.token}`)).toBeNull();
    expect(shares.list("ws-1")).toEqual([]);
    expect(shares.getBaseline(seeded.shareId)).toBeNull();
    expect(attachments.usage("ws-1")).toBe(0);
    // The session path was never consulted: this credential is the authorization.
    expect(sessionChecks).toEqual([]);
    // The host still gets its hook, so live sessions close for a service delete too.
    expect(deletions).toEqual(["ws-1"]);
  });

  it("converges on a retry, reporting zero rows instead of 404", async () => {
    orgs.claim("ws-1", "org-a");
    seedWorkspace();

    expect((await purge("ws-1")).status).toBe(200);
    // `exists` now answers false, which is exactly the state a retry after a
    // partial failure lands in: the caller deleted the row it learned the id from.
    const retry = await purge("ws-1");
    expect(retry.status).toBe(200);
    const body = (await retry.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      deleted: true,
      documents: 0,
      projected: 0,
      shares: 0,
      baselines: 0,
      attachments: 0,
    });
  });

  it("refuses a token that is not the purge credential", async () => {
    orgs.claim("ws-1", "org-a");
    seedWorkspace();

    const wrong = await purge("ws-1", "not-the-purge-token");
    expect(wrong.status).toBe(401);
    expect(documents.load("%LOR:ws-1")).not.toBeNull();
    expect(shares.list("ws-1")).toHaveLength(1);
    expect(attachments.usage("ws-1")).toBeGreaterThan(0);
    // A token that is not the service credential is read as a session and refused
    // there, so there is no third way in.
    expect(sessionChecks).toEqual(["ws-1"]);
  });

  it("accepts no service call at all while the relay has no purge token", async () => {
    // The server under test is the one without the variable, built here because the
    // fixture's has it.
    const bare = createServer((request, response) => {
      void handleWorkspaceRequest(request, response, {
        access: createWorkspaceAccess({
          sessions: sessions.verifier,
          orgs,
          licences: licenceClaims,
        }),
        // Unset, so a token nobody configured cannot purge a workspace.
        purgeToken: "",
        storage: paths,
      }).then((handled) => {
        if (!handled) response.writeHead(404);
      });
    });
    await new Promise<void>((resolve) => bare.listen(0, "127.0.0.1", resolve));
    const address = bare.address();
    if (!address || typeof address === "string") throw new Error("expected a TCP address");

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/workspaces/ws-1`, {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${PURGE_TOKEN}` },
        body: JSON.stringify({ confirm: "ws-1" }),
      });
      // The presented token is read as a session and refused there: a relay with no
      // purge credential has no service path, rather than one guarded by "".
      expect(response.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => bare.close(() => resolve()));
    }
  });

  it("reads the credential from the environment when the host passes none", async () => {
    // `sync/server.ts` does not pass one: the route reads `SUITE_RELAY_PURGE_TOKEN`
    // itself, so a deployment wires the service half by setting the variable.
    const fromEnv = "purge-token-from-env";
    vi.stubEnv("SUITE_RELAY_PURGE_TOKEN", fromEnv);
    const envServer = createServer((request, response) => {
      void handleWorkspaceRequest(request, response, {
        access: createWorkspaceAccess({
          sessions: sessions.verifier,
          orgs,
          licences: licenceClaims,
        }),
        storage: paths,
        attachments,
      }).then((handled) => {
        if (!handled) response.writeHead(404);
      });
    });
    await new Promise<void>((resolve) => envServer.listen(0, "127.0.0.1", resolve));
    const address = envServer.address();
    if (!address || typeof address === "string") throw new Error("expected a TCP address");

    try {
      seedWorkspace();
      const response = await fetch(`http://127.0.0.1:${address.port}/api/workspaces/ws-1`, {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${fromEnv}` },
        body: JSON.stringify({ confirm: "ws-1" }),
      });
      expect(response.status).toBe(200);
      expect(documents.load("%LOR:ws-1")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve) => envServer.close(() => resolve()));
    }
  });

  it("does not spend the account delete's rate budget", async () => {
    // The limiter allows ten deletes a minute per address. An account may own more
    // workspaces than that, and stopping halfway would leave it half-erased.
    for (let index = 0; index < 12; index += 1) {
      const response = await purge(`ws-batch-${index}`);
      expect(response.status).toBe(200);
    }
  });
});

describe("the routes the owner key took with it", () => {
  it("answers 404 for claim, rotate and status", async () => {
    const token = await session("1");
    for (const action of ["claim", "rotate", "status"]) {
      for (const method of ["POST", "GET"]) {
        const response = await fetch(`${baseUrl}/api/workspaces/ws-1/${action}`, {
          method,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          ...(method === "POST" ? { body: JSON.stringify({ ownerKey: "k" }) } : {}),
        });
        // `status` was a GET, so its method still exists on the path; what is
        // gone is the route. Both answers are "not found".
        expect([404, 405]).toContain(response.status);
      }
    }
  });

  it("answers CORS preflight and marks every response", async () => {
    const preflight = await fetch(`${baseUrl}/api/workspaces/ws-1`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("DELETE");
    // The owner-key header is no longer part of the allowlist.
    expect(preflight.headers.get("access-control-allow-headers")).not.toContain("x-suite-owner");
  });

  it("leaves non-API routes to the caller", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("not found");
  });
});
