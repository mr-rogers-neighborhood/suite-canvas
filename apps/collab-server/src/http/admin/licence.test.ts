import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LicenceClaims } from "@suite/licence";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLicenceClaimStore, type LicenceClaimStore } from "../../store/licenceClaims.js";
import { createDocumentStore } from "../../store/persistence.js";
import { createShareStore } from "../../store/shares.js";
import { createWorkspaceOrgStore } from "../../store/workspaceOrgs.js";
import { ADMIN_API_PATH, type AdminRequestDeps, handleAdminRequest } from "./index.js";
import { licenceOf } from "./workspaces.js";

/**
 * The licence writer, and the gate reading what it writes.
 *
 * The point of this endpoint is that a plan state is reachable without Stripe: an expired
 * row is a past-due subscription and an absent row is a cancelled one. So the test walks
 * the row through both and asks the same store the quota service asks.
 */
const OPERATOR_TOKEN = "operator-token";

const operator: AdminRequestDeps["sessions"] = {
  refresh: async () => {},
  verify: async (token): Promise<Awaited<ReturnType<AdminRequestDeps["sessions"]["verify"]>>> =>
    token === OPERATOR_TOKEN
      ? {
          ok: true,
          claims: {
            userId: "user-operator",
            organizationId: null,
            role: null,
            tier: "solo",
            limits: {},
            issuedAt: 0,
            expiresAt: Number.MAX_SAFE_INTEGER,
            operator: true,
          },
        }
      : { ok: false, reason: "signature" },
};

let directory = "";
let documents: ReturnType<typeof createDocumentStore>;
let shares: ReturnType<typeof createShareStore>;
let orgs: ReturnType<typeof createWorkspaceOrgStore>;
let licences: LicenceClaimStore;
let server: Server | null = null;
let baseUrl = "";

const WORKSPACE = "ws-licence";

beforeEach(() => {
  process.env.SUITE_AUTH_URL = "http://localhost:1236";
  // The hosted path is the one with caps: a self-host records an unlimited quota, which is
  // correct but says nothing about what a tier wrote.
  process.env.SUITE_HOSTED = "1";
  directory = mkdtempSync(join(tmpdir(), "suite-admin-licence-"));
  documents = createDocumentStore(join(directory, "documents.sqlite"));
  shares = createShareStore(join(directory, "shares.sqlite"));
  orgs = createWorkspaceOrgStore(join(directory, "workspaces.sqlite"));
  licences = createLicenceClaimStore(join(directory, "licences.sqlite"));
});

afterEach(async () => {
  delete process.env.SUITE_HOSTED;
  const closing = server;
  if (closing) await new Promise<void>((resolve) => closing.close(() => resolve()));
  documents.close();
  shares.close();
  orgs.close();
  licences.close();
  rmSync(directory, { recursive: true, force: true });
});

let built: AdminRequestDeps | null = null;
const deps = (): AdminRequestDeps => {
  if (built === null) throw new Error("start() first");
  return built;
};

async function start(): Promise<void> {
  const deps: AdminRequestDeps = {
    documents,
    shares,
    orgs,
    paths: {
      documents: join(directory, "documents.sqlite"),
      shares: join(directory, "shares.sqlite"),
      workspaces: join(directory, "workspaces.sqlite"),
    },
    sessions: operator,
    licences,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
  };
  built = deps;
  server = createServer((request, response) => {
    void handleAdminRequest(request, response, deps).then((handled) => {
      if (handled || response.writableEnded) return;
      response.writeHead(404).end("not found");
    });
  });
  const listing: Server = server ?? createServer();
  await new Promise<void>((resolve) => {
    listing.listen(0, "127.0.0.1", resolve);
  });
  const address = listing.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

function call(method: "PUT" | "DELETE" | "GET", body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${ADMIN_API_PATH}/workspaces/${WORKSPACE}/licence`, {
    method,
    headers: {
      authorization: ["Bearer", OPERATOR_TOKEN].join(" "),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("the admin licence row", () => {
  it("writes an active licence with the caps it was given", async () => {
    await start();

    const response = await call("PUT", {
      state: "active",
      documentBytes: 5_000_000,
      attachmentBytes: 2_000_000,
      licenceId: "lic-1",
    });

    expect(response.status).toBe(200);
    const stored = licences.get(WORKSPACE);
    expect(stored?.tier).toBe("active");
    expect(stored?.licenceId).toBe("lic-1");
    expect(stored?.quota.documentBytes).toBe(5_000_000);
    expect(stored?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("makes a workspace past due by writing an expired row", async () => {
    await start();
    await call("PUT", { state: "active" });

    await call("PUT", { state: "past-due" });

    // The row is there, which is what "past due" means: the gate has something to refuse.
    expect(licences.get(WORKSPACE)?.tier).toBe("past-due");
    expect(licences.get(WORKSPACE)?.expiresAt).toBeLessThan(Date.now());
  });

  it("cancels by clearing the row, which is what a lapsed account looks like", async () => {
    await start();
    await call("PUT", { state: "active" });

    const response = await call("DELETE");

    expect(response.status).toBe(200);
    expect(licences.get(WORKSPACE)).toBeNull();
  });

  it("refuses a state nobody can gate on", async () => {
    await start();

    const response = await call("PUT", { state: "gold" });

    expect(response.status).toBe(400);
    expect(licences.get(WORKSPACE)).toBeNull();
  });

  it("keeps the caps a second write does not mention", async () => {
    await start();
    await call("PUT", { state: "active", documentBytes: 7_000_000 });

    await call("PUT", { state: "past-due" });

    expect(licences.get(WORKSPACE)?.quota.documentBytes).toBe(7_000_000);
  });

  it("needs an operator session", async () => {
    await start();

    const response = await fetch(`${baseUrl}${ADMIN_API_PATH}/workspaces/${WORKSPACE}/licence`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "active" }),
    });

    expect(response.status).toBe(401);
    expect(licences.get(WORKSPACE)).toBeNull();
  });
});

/** The claim the writer produces, so a change in the shape is visible here. */
export type WrittenClaims = LicenceClaims;

describe("the row the panel reads", () => {
  it("carries the licence the gate would read, and says when it has expired", async () => {
    await start();
    await call("PUT", { state: "active", tier: "team", licenceId: "lic-9" });

    const active = licenceOf(deps(), WORKSPACE);
    // The body named a tier, so the row carries it; `state` decides the expiry.
    expect(active).toMatchObject({ tier: "team", expired: false, licenceId: "lic-9" });

    await call("PUT", { state: "past-due" });

    // The row is there and the gate refuses it: both facts travel, so the panel can say
    // "past due, so sync is refused" instead of showing a chip with a date in the past.
    expect(licenceOf(deps(), WORKSPACE)).toMatchObject({ expired: true });
  });

  it("says there is no licence after a cancellation", async () => {
    await start();
    await call("PUT", { state: "active" });

    await call("DELETE");

    expect(licenceOf(deps(), WORKSPACE)).toBeNull();
  });
});
