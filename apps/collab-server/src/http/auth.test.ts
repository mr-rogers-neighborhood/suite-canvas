import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLicenceClaimStore, type LicenceClaimStore } from "../store/licenceClaims.js";
import { createShareStore, type ShareStore } from "../store/shares.js";
import { createWorkspaceOrgStore, type WorkspaceOrgStore } from "../store/workspaceOrgs.js";
import { createRelaySeatGate } from "../sync/seatGate.js";
import { type AuthorizeDeps, authorize, decideAccess, resolveWorkerTokens } from "./auth.js";
import { createSessionFixture, type SessionFixture } from "./sessionFixture.js";

const encoder = new TextEncoder();
const PROJECTION_TOKEN = "projection-test-token";
const SOURCE_TOKEN = "source-test-token";

let directory: string;
let store: ShareStore;
let orgs: WorkspaceOrgStore;
let sessions: SessionFixture;
let deps: AuthorizeDeps;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "suite-auth-"));
  store = createShareStore(join(directory, "shares.sqlite"));
  orgs = createWorkspaceOrgStore(join(directory, "workspaces.sqlite"));
  sessions = await createSessionFixture();
  deps = {
    shares: store,
    sessions: sessions.verifier,
    workspaces: { orgs },
    projectionToken: PROJECTION_TOKEN,
    sourceToken: SOURCE_TOKEN,
  };
});

afterEach(() => {
  store.close();
  orgs.close();
  rmSync(directory, { recursive: true, force: true });
});

function encode(token: string): Uint8Array {
  return encoder.encode(token);
}

describe("authorize", () => {
  it("rejects an empty credential everywhere", async () => {
    await expect(authorize("ws-1", new Uint8Array(), deps)).resolves.toBeNull();
    await expect(authorize("ws-1:presence", new Uint8Array(), deps)).resolves.toBeNull();
    await expect(authorize("ws-1:cursors", new Uint8Array(), deps)).resolves.toBeNull();
    await expect(authorize("share-abc", new Uint8Array(), deps)).resolves.toBeNull();
  });

  it("gives a session the workspace its organization owns, and its ephemeral rooms", async () => {
    orgs.claim("ws-1", "org-a");
    const token = await sessions.sign();

    await expect(authorize("ws-1", encode(token), deps)).resolves.toBe("write");
    await expect(authorize("ws-1:presence", encode(token), deps)).resolves.toBe("write");
    await expect(authorize("ws-1:cursors", encode(token), deps)).resolves.toBe("write");
  });

  it("records the organization on the first verified join", async () => {
    expect(orgs.has("ws-1")).toBe(false);

    await expect(authorize("ws-1", encode(await sessions.sign()), deps)).resolves.toBe("write");

    expect(orgs.get("ws-1")?.organizationId).toBe("org-a");
  });

  it("never records anything for a credential that does not verify", async () => {
    // The property that survives the owner key: an unknown credential cannot
    // create a row, so a forged token cannot seed an ownership claim.
    expect(orgs.has("ws-1")).toBe(false);

    await expect(
      authorize("ws-1", encode(await sessions.sign({ foreignKey: true })), deps),
    ).resolves.toBeNull();
    await expect(authorize("ws-1", encode("not-a-token"), deps)).resolves.toBeNull();

    expect(orgs.has("ws-1")).toBe(false);
  });

  it("refuses a session from another organization", async () => {
    orgs.claim("ws-1", "org-a");
    const token = await sessions.sign({ organizationId: "org-b" });

    await expect(authorize("ws-1", encode(token), deps)).resolves.toBeNull();
    await expect(authorize("ws-1:presence", encode(token), deps)).resolves.toBeNull();
    expect(orgs.get("ws-1")?.organizationId).toBe("org-a");
  });

  it("refuses a session that names no organization", async () => {
    const token = await sessions.sign({ organizationId: null, role: null });

    await expect(authorize("ws-1", encode(token), deps)).resolves.toBeNull();
    expect(orgs.has("ws-1")).toBe(false);
  });

  it("refuses an expired or forged token without falling back to any other credential", async () => {
    const expired = await sessions.sign({ expiresInSeconds: -60 });
    await expect(authorize("ws-1", encode(expired), deps)).resolves.toBeNull();
    await expect(
      authorize("ws-1", encode(await sessions.sign({ foreignKey: true })), deps),
    ).resolves.toBeNull();
    expect(orgs.has("ws-1")).toBe(false);
  });

  it("does not let a session open a projection room", async () => {
    const token = await sessions.sign();

    await expect(authorize("share-abc", encode(token), deps)).resolves.toBeNull();
    await expect(authorize("share-abc:presence", encode(token), deps)).resolves.toBeNull();

    expect(orgs.has("share-abc")).toBe(false);
  });

  it("refuses a session when the deployment verifies none", async () => {
    const { sessions: _unused, ...withoutSessions } = deps;
    await expect(
      authorize("ws-1", encode(await sessions.sign()), withoutSessions),
    ).resolves.toBeNull();
  });

  it("lets a workspace viewer read the workspace and write its ephemeral rooms", async () => {
    const { token } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });

    await expect(authorize("ws-1", encode(token), deps)).resolves.toBe("read");
    await expect(authorize("ws-1:presence", encode(token), deps)).resolves.toBe("write");
    await expect(authorize("ws-1:cursors", encode(token), deps)).resolves.toBe("write");
  });

  it("gives a workspace editor write access to the workspace room", async () => {
    const { token } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });

    await expect(authorize("ws-1", encode(token), deps)).resolves.toBe("write");
    await expect(authorize("ws-1:presence", encode(token), deps)).resolves.toBe("write");
  });

  it("does not auto-claim a workspace for a share room", async () => {
    const { token } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });

    await expect(authorize("ws-1", encode(token), deps)).resolves.toBe("read");

    expect(orgs.has("ws-1")).toBe(false);
  });

  it("keeps a workspace share out of other rooms", async () => {
    const { token } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });

    await expect(authorize("ws-2", encode(token), deps)).resolves.toBeNull();
    await expect(authorize("ws-2:presence", encode(token), deps)).resolves.toBeNull();
    await expect(authorize(`share-${token}`, encode(token), deps)).resolves.toBeNull();
  });

  it("opens the projection room of a board viewer share", async () => {
    const { token } = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });

    await expect(authorize(`share-${token}`, encode(token), deps)).resolves.toBe("read");
    await expect(authorize(`share-${token}:presence`, encode(token), deps)).resolves.toBe("write");
    await expect(authorize(`share-${token}:cursors`, encode(token), deps)).resolves.toBe("write");
    await expect(authorize("ws-1", encode(token), deps)).resolves.toBeNull();
    await expect(authorize("share-other", encode(token), deps)).resolves.toBeNull();
  });

  it("supports editor projection rooms even though the API gates them", async () => {
    const { token } = store.create({
      workspaceId: "ws-1",
      scope: "card",
      role: "editor",
      cardId: "card-1",
    });

    await expect(authorize(`share-${token}`, encode(token), deps)).resolves.toBe("write");
    await expect(authorize(`share-${token}:presence`, encode(token), deps)).resolves.toBe("write");
  });

  it("rejects unknown and revoked tokens", async () => {
    const { token, share } = store.create({
      workspaceId: "ws-1",
      scope: "workspace",
      role: "editor",
    });

    await expect(authorize("ws-1", encode("not-a-token"), deps)).resolves.toBeNull();

    store.revoke(share.id);
    await expect(authorize("ws-1", encode(token), deps)).resolves.toBeNull();
  });

  it("limits the projection token to projection rooms", async () => {
    await expect(authorize("share-abc", encode(PROJECTION_TOKEN), deps)).resolves.toBe("write");
    await expect(authorize("share-abc:presence", encode(PROJECTION_TOKEN), deps)).resolves.toBe(
      "write",
    );
    await expect(authorize("ws-1", encode(PROJECTION_TOKEN), deps)).resolves.toBeNull();
  });

  it("limits the source token to workspaces with an active editor share", async () => {
    await expect(authorize("ws-1", encode(SOURCE_TOKEN), deps)).resolves.toBeNull();

    store.create({ workspaceId: "ws-1", scope: "board", role: "editor", boardId: "b-1" });
    await expect(authorize("ws-1", encode(SOURCE_TOKEN), deps)).resolves.toBe("write");
    await expect(authorize("share-abc", encode(SOURCE_TOKEN), deps)).resolves.toBeNull();
  });

  it("does not treat empty worker tokens as a match", async () => {
    const empty: AuthorizeDeps = {
      shares: store,
      sessions: sessions.verifier,
      workspaces: { orgs },
      projectionToken: "",
      sourceToken: "",
    };

    await expect(authorize("share-abc", new Uint8Array(), empty)).resolves.toBeNull();
    await expect(authorize("ws-1", new Uint8Array(), empty)).resolves.toBeNull();
    await expect(authorize("ws-1", encode(""), empty)).resolves.toBeNull();
  });

  it("ignores non-UTF8 bytes instead of throwing", async () => {
    orgs.claim("ws-1", "org-a");

    await expect(authorize("ws-1", new Uint8Array([0xff, 0xfe]), deps)).resolves.toBeNull();
  });

  it("rejects a malformed credential without throwing", async () => {
    await expect(authorize("ws-1", encode("x".repeat(600)), deps)).resolves.toBeNull();
  });
});

describe("authorize with an exchanged share session", () => {
  it("opens the same room as its token with the same role", () => {
    const { share } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
    const { session } = store.createSession(share);

    return Promise.all([
      expect(authorize("ws-1", encode(session), deps)).resolves.toBe("read"),
      expect(authorize("ws-1:presence", encode(session), deps)).resolves.toBe("write"),
      expect(authorize("ws-1:cursors", encode(session), deps)).resolves.toBe("write"),
    ]);
  });

  it("gives an editor session write access to its projection room", () => {
    const { share } = store.create({
      workspaceId: "ws-1",
      scope: "card",
      role: "editor",
      cardId: "card-1",
    });
    const { session } = store.createSession(share);
    const roomId = share.roomId ?? "";

    return Promise.all([
      expect(authorize(roomId, encode(session), deps)).resolves.toBe("write"),
      expect(authorize(`${roomId}:presence`, encode(session), deps)).resolves.toBe("write"),
      expect(authorize(roomId, encode("not-a-session"), deps)).resolves.toBeNull(),
    ]);
  });

  it("keeps the raw token path working beside the session", () => {
    const { token, share } = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    const { session } = store.createSession(share);

    return Promise.all([
      expect(authorize(share.roomId ?? "", encode(token), deps)).resolves.toBe("read"),
      expect(authorize(share.roomId ?? "", encode(session), deps)).resolves.toBe("read"),
    ]);
  });

  it("rejects an expired session", () => {
    const { share } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
    const { session } = store.createSession(share, -1);

    return expect(authorize("ws-1", encode(session), deps)).resolves.toBeNull();
  });

  it("rejects the session of a revoked share", () => {
    const { share } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    const { session } = store.createSession(share);

    store.revoke(share.id);

    return expect(authorize("ws-1", encode(session), deps)).resolves.toBeNull();
  });

  it("does not transfer a session to another share's room", () => {
    const first = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    const second = store.create({
      workspaceId: "ws-2",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    const { session } = store.createSession(first.share);

    return Promise.all([
      expect(authorize(first.share.roomId ?? "", encode(session), deps)).resolves.toBe("read"),
      expect(authorize(second.share.roomId ?? "", encode(session), deps)).resolves.toBeNull(),
      expect(
        authorize(second.share.roomId ?? ":presence", encode(session), deps),
      ).resolves.toBeNull(),
      expect(authorize("ws-2", encode(session), deps)).resolves.toBeNull(),
    ]);
  });

  it("never lets an exchanged share session open the workspace it projects", () => {
    orgs.claim("ws-1", "org-a");
    const { share } = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "b",
    });
    const { session } = store.createSession(share);

    // The session is scoped to the projection room, not the workspace itself.
    return expect(authorize("ws-1", encode(session), deps)).resolves.toBeNull();
  });
});

describe("resolveWorkerTokens", () => {
  it("reuses configured tokens and keeps them separate", () => {
    const tokens = resolveWorkerTokens({
      SUITE_PROJECTION_TOKEN: "projection",
      SUITE_SOURCE_TOKEN: "source",
    } as NodeJS.ProcessEnv);

    expect(tokens).toEqual({ projectionToken: "projection", sourceToken: "source" });
  });

  it("generates two different tokens when unset", () => {
    const env = {} as NodeJS.ProcessEnv;
    const tokens = resolveWorkerTokens(env);

    expect(tokens.projectionToken.length).toBeGreaterThanOrEqual(32);
    expect(tokens.sourceToken.length).toBeGreaterThanOrEqual(32);
    expect(tokens.projectionToken).not.toBe(tokens.sourceToken);
    expect(env.SUITE_PROJECTION_TOKEN).toBe(tokens.projectionToken);
    expect(env.SUITE_SOURCE_TOKEN).toBe(tokens.sourceToken);
  });

  it("accepts the legacy internal token only as the projection token", () => {
    const tokens = resolveWorkerTokens({ SUITE_INTERNAL_TOKEN: "legacy" } as NodeJS.ProcessEnv);

    expect(tokens.projectionToken).toBe("legacy");
    expect(tokens.sourceToken).not.toBe("legacy");
  });
});

describe("authorize with the seat gate wired in", () => {
  const enforced = () => createRelaySeatGate({ enforced: true });
  const inert = () => createRelaySeatGate({ enforced: false });

  it("is unchanged when no gate is configured, which is every self-host", async () => {
    orgs.claim("ws-1", "org-a");
    await expect(
      authorize("ws-1", encode(await sessions.sign()), { ...deps, seats: inert() }),
    ).resolves.toBe("write");
  });

  it("admits an account whose token carries a tier", async () => {
    orgs.claim("ws-1", "org-a");
    await expect(
      authorize("ws-1", encode(await sessions.sign()), { ...deps, seats: enforced() }),
    ).resolves.toBe("write");
  });

  it("drops a session the entitlement gate refuses", async () => {
    // The credential is fine; the entitlement is not. The room stays shut, and
    // the answer is a refusal rather than a downgraded anonymous join.
    orgs.claim("ws-1", "org-a");
    const token = await sessions.sign({ tier: " " });
    // A token without a tier never verifies, so this is the same refusal one
    // layer up; the point is that nothing opens.
    await expect(
      authorize("ws-1", encode(token), { ...deps, seats: enforced() }),
    ).resolves.toBeNull();
  });

  it("leaves the internal worker tokens ungated", async () => {
    // The projection worker is not a seat: it writes only projection rooms and
    // holding it back on a lapsed entitlement would leave drafts unpublished.
    await expect(
      authorize("share-abc", encode(PROJECTION_TOKEN), { ...deps, seats: enforced() }),
    ).resolves.toBe("write");
  });
});

describe("the plan at the door", () => {
  let licences: LicenceClaimStore;

  beforeEach(() => {
    licences = createLicenceClaimStore(join(directory, "licences.sqlite"));
  });

  afterEach(() => {
    licences.close();
  });

  const hosted = (): AuthorizeDeps => ({ ...deps, workspaces: { orgs, licences } });

  it("keeps a free organization out of a workspace it does not hold", async () => {
    // The socket used to walk in and record the organization, which is how an account with
    // no plan read "Synced" while the control plane had just refused the same workspace.
    const token = await sessions.sign({ tier: "free", limits: {} });

    const decision = await decideAccess("ws-1", encode(token), hosted());

    expect(decision).toMatchObject({ ok: false, reason: "plan-required" });
    expect(orgs.has("ws-1")).toBe(false);
    await expect(authorize("ws-1", encode(token), hosted())).resolves.toBeNull();
  });

  it("answers the access question with the same plan refusal and writes nothing", async () => {
    // The client asks this route for the reason a join was refused. An "allowed" answer
    // beside a shut door leaves the panel with nothing true to say.
    const token = await sessions.sign({ tier: "free", limits: {} });

    const decision = await decideAccess("ws-1", encode(token), hosted(), { claim: false });

    expect(decision).toMatchObject({ ok: false, reason: "plan-required" });
    expect(orgs.has("ws-1")).toBe(false);
  });

  it("keeps a workspace the organization already holds open after the licence lapses", async () => {
    orgs.claim("ws-1", "org-a");
    const token = await sessions.sign({ tier: "free", limits: {} });

    await expect(authorize("ws-1", encode(token), hosted())).resolves.toBe("write");
  });

  it("names the ceiling when the plan covers workspaces but not another one", async () => {
    orgs.claim("ws-1", "org-a");
    const token = await sessions.sign({ limits: { workspaces: 1 } });

    const decision = await decideAccess("ws-2", encode(token), hosted());

    expect(decision).toMatchObject({ ok: false, reason: "workspace-limit" });
  });

  it("leaves a self-host alone, because it has no plan to check", async () => {
    const token = await sessions.sign({ tier: "free", limits: {} });

    // No entitlement store means no subscription and nothing to enforce.
    await expect(authorize("ws-1", encode(token), deps)).resolves.toBe("write");
  });
});
