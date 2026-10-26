import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createQuotaService,
  type Limits,
  type QuotaOptions,
  resolveLimits,
} from "../config/limits.js";
import { createLogger, type Logger } from "../logging.js";
import type { AdminPaths } from "../ops/admin.js";
import { type LicenceClaims, signLicence } from "../store/licence.js";
import { createDocumentStore } from "../store/persistence.js";
import { createShareStore } from "../store/shares.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "../store/workspaces.js";
import { resetRateLimits } from "./rateLimit.js";
import {
  createLicenceClaimStore,
  handleWorkspaceRequest,
  type LicenceClaimStore,
  type WorkspaceQuotaGate,
} from "./workspaceHttp.js";

const { publicKey: licencePublicKey, privateKey: licencePrivateKey } =
  generateKeyPairSync("ed25519");
const licencePublicPem = licencePublicKey.export({ type: "spki", format: "pem" }).toString();
const licencePrivatePem = licencePrivateKey.export({ type: "pkcs8", format: "pem" }).toString();

let directory: string;
let registry: WorkspaceRegistry;
let licenceClaims: LicenceClaimStore;
let documents: ReturnType<typeof createDocumentStore>;
let shares: ReturnType<typeof createShareStore>;
let quotaGate: WorkspaceQuotaGate | undefined;
let server: Server;
let baseUrl: string;
let rotations: [string, string][];
let paths: AdminPaths;
let deletions: string[];

function hostedClaims(overrides: Partial<LicenceClaims> = {}): LicenceClaims {
  const issuedAt = Date.now() - 60_000;
  return {
    v: 1,
    id: "lic-hosted-1",
    tier: "hosted",
    workspaces: 25,
    documentBytes: 5 * 1024 * 1024,
    attachmentBytes: 25 * 1024 * 1024,
    issuedAt,
    expiresAt: issuedAt + 30 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

beforeEach(async () => {
  resetRateLimits();
  rotations = [];
  deletions = [];
  quotaGate = undefined;
  directory = mkdtempSync(join(tmpdir(), "suite-workspace-api-"));
  // Every store is file-backed: the owner delete runs the operator CLI's
  // implementation, which edits the files named here.
  paths = {
    workspaces: join(directory, "workspaces.sqlite"),
    documents: join(directory, "documents.sqlite"),
    shares: join(directory, "shares.sqlite"),
  };
  registry = createWorkspaceRegistry(paths.workspaces);
  licenceClaims = createLicenceClaimStore(join(directory, "licences.sqlite"));
  documents = createDocumentStore(paths.documents);
  shares = createShareStore(paths.shares);

  server = createServer((request, response) => {
    const hooks = {
      onRotated: (workspaceId: string, previousOwnerKey: string) => {
        rotations.push([workspaceId, previousOwnerKey]);
      },
      onDeleted: (workspaceId: string) => {
        deletions.push(workspaceId);
      },
      storage: paths,
      licence: { publicKey: licencePublicPem, claims: licenceClaims },
      ...(quotaGate ? { quota: quotaGate } : {}),
    };
    void handleWorkspaceRequest(request, response, registry, hooks).then((handled) => {
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
  registry.close();
  licenceClaims.close();
  documents.close();
  shares.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function claim(workspaceId: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function rotate(workspaceId: string, currentKey: string | null, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/rotate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(currentKey === null ? {} : { authorization: `Bearer ${currentKey}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deleteWorkspaceRequest(
  workspaceId: string,
  currentKey: string | null,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      ...(currentKey === null ? {} : { authorization: `Bearer ${currentKey}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("workspace claim API", () => {
  it("claims a workspace and accepts the same key again", async () => {
    const first = await claim("ws-1", { ownerKey: "owner-key-1" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ workspaceId: "ws-1", claimed: true });

    const again = await claim("ws-1", { ownerKey: "owner-key-1" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ workspaceId: "ws-1", claimed: true });
  });

  it("rejects a different key with a readable conflict", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });
    const conflict = await claim("ws-1", { ownerKey: "owner-key-2" });

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: "This workspace is protected by a different owner key.",
    });
    expect(registry.verify("ws-1", "owner-key-1")).toBe(true);
  });

  it("rejects malformed bodies and identifiers", async () => {
    const missing = await claim("ws-1", {});
    expect(missing.status).toBe(400);

    const empty = await claim("ws-1", { ownerKey: "   " });
    expect(empty.status).toBe(400);

    const notJson = await claim("ws-1", "{not json");
    expect(notJson.status).toBe(400);

    const array = await claim("ws-1", []);
    expect(array.status).toBe(400);

    const noBody = await fetch(`${baseUrl}/api/workspaces/ws-1/claim`, { method: "POST" });
    expect(noBody.status).toBe(400);
  });

  it("answers CORS preflight and marks every response", async () => {
    const preflight = await fetch(`${baseUrl}/api/workspaces/ws-1/claim`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("content-type");

    const claimed = await claim("ws-1", { ownerKey: "owner-key-1" });
    expect(claimed.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects unsupported methods and unknown routes", async () => {
    const wrongMethod = await fetch(`${baseUrl}/api/workspaces/ws-1/claim`);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST, OPTIONS");

    const unknown = await fetch(`${baseUrl}/api/workspaces/ws-1`);
    expect(unknown.status).toBe(404);

    const malformed = await fetch(`${baseUrl}/api/workspaces/%E0%A4%A/claim`, { method: "POST" });
    expect(malformed.status).toBe(400);
  });

  it("leaves non-API routes to the caller", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("not found");
  });
});

describe("workspace rotate API", () => {
  it("reports the previous owner key to the rotation hook", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });
    const rotated = await rotate("ws-1", "owner-key-1", { newOwnerKey: "owner-key-2" });
    expect(rotated.status).toBe(200);
    expect(rotations).toEqual([["ws-1", "owner-key-1"]]);
  });

  it("does not report a rejected rotation", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });
    const denied = await rotate("ws-1", "owner-key-9", { newOwnerKey: "owner-key-2" });
    expect(denied.status).toBe(403);
    expect(rotations).toEqual([]);
  });

  it("rotates with the current key and accepts only the new one afterwards", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });

    const rotated = await rotate("ws-1", "owner-key-1", { newOwnerKey: "owner-key-2" });
    expect(rotated.status).toBe(200);
    expect(await rotated.json()).toEqual({ workspaceId: "ws-1", rotated: true });
    expect(registry.verify("ws-1", "owner-key-2")).toBe(true);
    expect(registry.verify("ws-1", "owner-key-1")).toBe(false);

    // The old editor link fails; the new key works.
    const stale = await claim("ws-1", { ownerKey: "owner-key-1" });
    expect(stale.status).toBe(409);
    const fresh = await claim("ws-1", { ownerKey: "owner-key-2" });
    expect(fresh.status).toBe(200);
  });

  it("requires the current key in the Authorization header", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });

    const missing = await rotate("ws-1", null, { newOwnerKey: "owner-key-2" });
    expect(missing.status).toBe(401);

    const blank = await rotate("ws-1", "   ", { newOwnerKey: "owner-key-2" });
    expect(blank.status).toBe(401);

    const bare = await fetch(`${baseUrl}/api/workspaces/ws-1/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "owner-key-1" },
      body: JSON.stringify({ newOwnerKey: "owner-key-2" }),
    });
    expect(bare.status).toBe(401);

    // A refused rotation leaves the original key in place.
    expect(registry.verify("ws-1", "owner-key-1")).toBe(true);
  });

  it("refuses a different current key with 403", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });

    const denied = await rotate("ws-1", "owner-key-9", { newOwnerKey: "owner-key-2" });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: "The current owner key does not match this workspace.",
    });
    expect(registry.verify("ws-1", "owner-key-1")).toBe(true);
  });

  it("refuses to rotate a workspace that has no owner", async () => {
    const unknown = await rotate("ws-unknown", "owner-key-1", { newOwnerKey: "owner-key-2" });
    expect(unknown.status).toBe(403);
    expect(registry.has("ws-unknown")).toBe(false);
  });

  it("rejects malformed rotation bodies", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });

    const missing = await rotate("ws-1", "owner-key-1", {});
    expect(missing.status).toBe(400);

    const blank = await rotate("ws-1", "owner-key-1", { newOwnerKey: "  " });
    expect(blank.status).toBe(400);

    const array = await rotate("ws-1", "owner-key-1", []);
    expect(array.status).toBe(400);

    const notJson = await rotate("ws-1", "owner-key-1", "{not json");
    expect(notJson.status).toBe(400);

    expect(registry.verify("ws-1", "owner-key-1")).toBe(true);
  });

  it("answers CORS preflight and rejects other methods", async () => {
    const preflight = await fetch(`${baseUrl}/api/workspaces/ws-1/rotate`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);

    const wrongMethod = await fetch(`${baseUrl}/api/workspaces/ws-1/rotate`);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST, OPTIONS");
  });
});

describe("workspace delete API", () => {
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
    return { token: created.token, shareId: created.share.id };
  }

  it("lets the owner delete the workspace and everything stored beside it", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });
    const seeded = seedWorkspace();
    licenceClaims.record("ws-1", hostedClaims(), Date.now());

    const response = await deleteWorkspaceRequest("ws-1", "owner-key-1", { confirm: "ws-1" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.deleted).toBe(true);
    expect(body.ownerRows).toBe(1);
    expect(body.shares).toBe(1);
    expect(body.baselines).toBe(1);
    expect(body.documents).toBe(1);
    expect(body.projected).toBe(1);
    expect(body.licenceRows).toBe(1);

    expect(registry.has("ws-1")).toBe(false);
    expect(documents.load("%LOR:ws-1")).toBeNull();
    expect(documents.load(`%LOR:share-${seeded.token}`)).toBeNull();
    expect(shares.list("ws-1")).toEqual([]);
    expect(shares.getBaseline(seeded.shareId)).toBeNull();
    expect(licenceClaims.get("ws-1")).toBeNull();
    // The hook a host uses to close live sessions sees the committed delete.
    expect(deletions).toEqual(["ws-1"]);
  });

  it("refuses a key that does not own the workspace", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });
    seedWorkspace();

    const denied = await deleteWorkspaceRequest("ws-1", "owner-key-2", { confirm: "ws-1" });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: "The owner key does not match this workspace.",
    });
    expect(registry.has("ws-1")).toBe(true);
    expect(documents.load("%LOR:ws-1")).not.toBeNull();
    expect(deletions).toEqual([]);
  });

  it("requires the workspace id in the body", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });
    seedWorkspace();

    const mismatch = await deleteWorkspaceRequest("ws-1", "owner-key-1", { confirm: "ws-2" });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({
      error: 'Deleting a workspace requires {"confirm":"ws-1"} in the request body.',
    });

    const missing = await deleteWorkspaceRequest("ws-1", "owner-key-1", {});
    expect(missing.status).toBe(400);

    expect(registry.has("ws-1")).toBe(true);
    expect(documents.load("%LOR:ws-1")).not.toBeNull();
  });

  it("answers 404 for a workspace the relay does not know", async () => {
    const unknown = await deleteWorkspaceRequest("ws-missing", "owner-key-1", {
      confirm: "ws-missing",
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Workspace not found." });
  });

  it("requires an owner key at all", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });
    const anonymous = await deleteWorkspaceRequest("ws-1", null, { confirm: "ws-1" });
    expect(anonymous.status).toBe(401);
    expect(registry.has("ws-1")).toBe(true);
  });

  it("is rate limited like rotation", async () => {
    for (let index = 0; index < 10; index += 1) {
      const response = await deleteWorkspaceRequest(`ws-limit-${index}`, "owner-key-1", {
        confirm: `ws-limit-${index}`,
      });
      expect(response.status).toBe(404);
    }
    const limited = await deleteWorkspaceRequest("ws-limit-final", "owner-key-1", {
      confirm: "ws-limit-final",
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("does not let a share token delete the workspace", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });
    const seeded = seedWorkspace();

    const response = await deleteWorkspaceRequest("ws-1", seeded.token, { confirm: "ws-1" });
    expect(response.status).toBe(403);
    expect(registry.has("ws-1")).toBe(true);
    expect(shares.list("ws-1")).toHaveLength(1);
  });
});

describe("workspace API limits", () => {
  it("rate-limits ownership claims per address", async () => {
    for (let index = 0; index < 600; index += 1) {
      const response = await claim(`ws-limit-${index}`, { ownerKey: `key-${index}` });
      expect(response.status).toBe(200);
    }
    const limited = await claim("ws-limit-final", { ownerKey: "key-final" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});

describe("hosted licence gate", () => {
  beforeEach(() => {
    vi.stubEnv("SUITE_HOSTED", "1");
  });

  it("refuses a claim with no licence and names the reason", async () => {
    const refused = await claim("ws-1", { ownerKey: "owner-key-1" });

    expect(refused.status).toBe(402);
    expect(await refused.json()).toEqual({
      error: "Hosted sync needs a licence key: no licence key was sent. Local editing still works.",
      reason: "missing",
    });
    // A refused claim never registers the workspace, so the caller keeps editing locally.
    expect(registry.has("ws-1")).toBe(false);
  });

  it("refuses a malformed licence", async () => {
    const refused = await claim("ws-1", { ownerKey: "owner-key-1", licence: "not-a-token" });

    expect(refused.status).toBe(402);
    const body = (await refused.json()) as { reason: string; error: string };
    expect(body.reason).toBe("malformed");
    expect(body.error).toContain("Local editing still works");
    expect(registry.has("ws-1")).toBe(false);
  });

  it("refuses an expired licence", async () => {
    const issuedAt = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const token = signLicence(
      hostedClaims({ issuedAt, expiresAt: issuedAt + 24 * 60 * 60 * 1000 }),
      licencePrivatePem,
    );
    const refused = await claim("ws-1", { ownerKey: "owner-key-1", licence: token });

    expect(refused.status).toBe(402);
    expect(((await refused.json()) as { reason: string }).reason).toBe("expired");
    expect(registry.has("ws-1")).toBe(false);
  });

  it("refuses a licence signed by another key", async () => {
    const { privateKey: foreignKey } = generateKeyPairSync("ed25519");
    const token = signLicence(
      hostedClaims(),
      foreignKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    const refused = await claim("ws-1", { ownerKey: "owner-key-1", licence: token });

    expect(refused.status).toBe(402);
    expect(((await refused.json()) as { reason: string }).reason).toBe("bad-signature");
  });

  it("accepts a valid licence and records the licence id with its quota", async () => {
    const token = signLicence(hostedClaims(), licencePrivatePem);
    const accepted = await claim("ws-1", { ownerKey: "owner-key-1", licence: token });

    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ workspaceId: "ws-1", claimed: true });
    expect(registry.verify("ws-1", "owner-key-1")).toBe(true);

    const record = licenceClaims.get("ws-1");
    expect(record).not.toBeNull();
    expect(record).toMatchObject({
      workspaceId: "ws-1",
      licenceId: "lic-hosted-1",
      tier: "hosted",
      quota: {
        workspaces: 25,
        documentBytes: 5 * 1024 * 1024,
        attachmentBytes: 25 * 1024 * 1024,
      },
    });
  });

  it("ignores the licence field entirely on a self-host", async () => {
    vi.unstubAllEnvs();
    const accepted = await claim("ws-1", { ownerKey: "owner-key-1", licence: "garbage" });

    expect(accepted.status).toBe(200);
    expect(registry.verify("ws-1", "owner-key-1")).toBe(true);
    expect(licenceClaims.get("ws-1")).toBeNull();
  });
});

function quotaService(
  env: Record<string, string | undefined> = {},
  overrides: Partial<Limits> | null = null,
  licenceBytes?: (workspaceId: string) => { documentBytes: number } | null,
  logger?: Logger,
) {
  const resolved = resolveLimits(env, overrides);
  const options: QuotaOptions = {
    documents,
    shares,
    limits: () => resolved.limits,
    size: () => documents.size(),
  };
  if (licenceBytes) options.licenceBytes = licenceBytes;
  if (logger) options.logger = logger;
  return createQuotaService(options);
}

function status(workspaceId: string, key: string | null): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/status`, {
    headers: key === null ? {} : { authorization: `Bearer ${key}` },
  });
}

describe("workspace quotas", () => {
  it("refuses a new workspace at the instance cap and allows one below it", async () => {
    quotaGate = { quotas: quotaService({ SUITE_MAX_WORKSPACES: "2" }) };

    expect((await claim("ws-a", { ownerKey: "key-a" })).status).toBe(200);
    documents.save("%LOR:ws-a", new Uint8Array(16));

    // One workspace exists, the cap is two: the next claim is allowed.
    expect((await claim("ws-b", { ownerKey: "key-b" })).status).toBe(200);
    documents.save("%LOR:ws-b", new Uint8Array(16));

    const refused = await claim("ws-c", { ownerKey: "key-c" });
    expect(refused.status).toBe(429);
    const body = (await refused.json()) as { error: string; reason: string };
    expect(body.reason).toBe("workspace-limit");
    expect(body.error).toContain("2 of 2 workspaces");
    expect(registry.has("ws-c")).toBe(false);

    // An existing workspace is never refused, even at the cap.
    expect((await claim("ws-a", { ownerKey: "key-a" })).status).toBe(200);
  });

  it("refuses a new workspace above the hard disk mark but keeps existing ones saving", async () => {
    expect((await claim("ws-a", { ownerKey: "key-a" })).status).toBe(200);

    quotaGate = {
      quotas: quotaService({ SUITE_DISK_SOFT_BYTES: "1", SUITE_DISK_HARD_BYTES: "2" }),
    };
    expect(documents.size()).toBeGreaterThan(2);

    const refused = await claim("ws-b", { ownerKey: "key-b" });
    expect(refused.status).toBe(507);
    const body = (await refused.json()) as { error: string; reason: string };
    expect(body.reason).toBe("disk-full");
    expect(body.error).toContain("hard limit");
    expect(body.error).toContain("Existing workspaces keep saving");
    expect(registry.has("ws-b")).toBe(false);

    expect((await claim("ws-a", { ownerKey: "key-a" })).status).toBe(200);
    documents.save("%LOR:ws-a", new Uint8Array(64));
    expect(documents.load("%LOR:ws-a")?.byteLength).toBe(64);
  });

  it("is unlimited on a self-host with no licence and no env", async () => {
    quotaGate = { quotas: quotaService() };
    for (const id of ["ws-1", "ws-2", "ws-3", "ws-4"]) {
      expect((await claim(id, { ownerKey: `key-${id}` })).status).toBe(200);
    }
    expect(quotaGate.quotas.limits().maxWorkspaces).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps accepting saves over the document budget and reports it on status", async () => {
    quotaGate = { quotas: quotaService({ SUITE_DOCUMENT_BYTES_PER_WORKSPACE: "10" }) };
    expect((await claim("ws-1", { ownerKey: "key-1" })).status).toBe(200);

    const bytes = new TextEncoder().encode("x".repeat(500));
    documents.save("%LOR:ws-1", bytes);
    expect(documents.load("%LOR:ws-1")).toEqual(bytes);

    const report = await status("ws-1", "key-1");
    expect(report.status).toBe(200);
    const body = (await report.json()) as {
      quota: { overQuota: boolean; documentBytes: number; documentBudget: number };
      limits: { documentBytesPerWorkspace: number };
      shareBlock: { status: number; message: string };
    };
    expect(body.quota.overQuota).toBe(true);
    expect(body.quota.documentBytes).toBe(500);
    expect(body.quota.documentBudget).toBe(10);
    expect(body.limits.documentBytesPerWorkspace).toBe(10);
    expect(body.shareBlock.status).toBe(409);
    expect(body.shareBlock.message).toContain("over its document budget");
    expect(body.shareBlock.message).toContain("Your edits are still saved");

    // The workspace keeps working read/write: claim and rotate still succeed.
    expect((await claim("ws-1", { ownerKey: "key-1" })).status).toBe(200);
    expect((await rotate("ws-1", "key-1", { newOwnerKey: "key-2" })).status).toBe(200);
    documents.save("%LOR:ws-1", new TextEncoder().encode("y".repeat(900)));
    expect(documents.load("%LOR:ws-1")?.byteLength).toBe(900);

    // Only the owner may read the status, and only with the current key.
    expect((await status("ws-1", "key-1")).status).toBe(403);
    expect((await status("ws-1", "key-2")).status).toBe(200);
    expect((await status("ws-unknown", "key-2")).status).toBe(403);
    expect((await status("ws-1", null)).status).toBe(401);
  });

  it("refuses a new workspace when the licence has no workspace left", async () => {
    vi.stubEnv("SUITE_HOSTED", "1");
    quotaGate = {
      quotas: quotaService(),
      licenceWorkspaces: (licenceId) => licenceClaims.countForLicence(licenceId),
    };
    const token = signLicence(hostedClaims({ workspaces: 1 }), licencePrivatePem);

    expect((await claim("ws-1", { ownerKey: "key-1", licence: token })).status).toBe(200);

    const refused = await claim("ws-2", { ownerKey: "key-2", licence: token });
    expect(refused.status).toBe(429);
    const body = (await refused.json()) as { error: string; reason: string };
    expect(body.reason).toBe("workspace-limit");
    expect(body.error).toContain("licence already holds 1 of 1 workspaces");
    expect(registry.has("ws-2")).toBe(false);

    // The same licence may still re-claim the workspace it already holds.
    expect((await claim("ws-1", { ownerKey: "key-1", licence: token })).status).toBe(200);
  });

  it("allows a claim above the soft disk mark and logs a warning", async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
    quotaGate = {
      quotas: quotaService(
        { SUITE_DISK_SOFT_BYTES: "1", SUITE_DISK_HARD_BYTES: "1000000000" },
        null,
        undefined,
        logger,
      ),
    };

    expect((await claim("ws-soft", { ownerKey: "key-soft" })).status).toBe(200);
    expect(registry.has("ws-soft")).toBe(true);
    expect(lines.some((line) => line.includes("soft watermark"))).toBe(true);
  });

  it("serves a null quota when the server runs without quota wiring", async () => {
    await claim("ws-1", { ownerKey: "key-1" });
    const report = await status("ws-1", "key-1");
    expect(await report.json()).toEqual({ workspaceId: "ws-1", quota: null });

    const wrongMethod = await fetch(`${baseUrl}/api/workspaces/ws-1/status`, { method: "POST" });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET, OPTIONS");
  });
});
