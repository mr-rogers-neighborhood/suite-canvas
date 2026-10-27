import { describe, expect, it } from "vitest";
import {
  ACCOUNT_WORKSPACES_PATH,
  readAccountWorkspaces,
  syncLabelOf,
  syncStateOf,
} from "./accountWorkspaces";

/**
 * What the launcher can honestly say about a workspace.
 *
 * The distinction that matters is "no session" against "an account that holds
 * nothing": the first means the row cannot know, the second is the one moment
 * offering to bring local work along is worth doing.
 */
const session = async () => ({ authorization: "Bearer token" });

function answer(status: number, body: unknown): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
}

describe("reading the account's workspaces", () => {
  it("asks the account route on the collab origin", async () => {
    let seen = "";
    const fetch = (async (url: string) => {
      seen = url;
      return new Response(JSON.stringify({ workspaces: [], organizations: [] }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await readAccountWorkspaces({ base: "https://app.suite.run", fetch, authorization: session });

    expect(seen).toBe(`https://app.suite.run${ACCOUNT_WORKSPACES_PATH}`);
  });

  it("is null when there is no session, without asking", async () => {
    let called = false;
    const fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const result = await readAccountWorkspaces({
      fetch,
      authorization: async () => ({}),
    });

    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it("is null when the answer is a refusal", async () => {
    const result = await readAccountWorkspaces({
      fetch: answer(401, { ok: false }),
      authorization: session,
    });
    expect(result).toBeNull();
  });

  it("is null when the request never leaves", async () => {
    const fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;
    expect(await readAccountWorkspaces({ fetch, authorization: session })).toBeNull();
  });

  it("keeps the workspaces and drops anything malformed", async () => {
    const result = await readAccountWorkspaces({
      fetch: answer(200, {
        ok: true,
        workspaces: [
          { id: "ws-1", name: "Research", organizationId: "org-1", createdAt: 1, archivedAt: null },
          { name: "no id" },
        ],
        organizations: [{ id: "org-1", name: "Personal", role: "owner" }],
      }),
      authorization: session,
    });

    expect(result?.workspaces.map((workspace) => workspace.id)).toEqual(["ws-1"]);
    expect(result?.organizations[0]?.role).toBe("owner");
  });
});

describe("what a row says", () => {
  const account = {
    workspaces: [
      { id: "ws-1", organizationId: "org-1", name: "Research", createdAt: 1, archivedAt: null },
    ],
    organizations: [],
  };

  it("says synced for a workspace the account holds", () => {
    expect(syncStateOf("ws-1", account)).toBe("synced");
    expect(syncLabelOf("synced")).toBe("Synced");
  });

  it("says on this device for one it does not", () => {
    expect(syncStateOf("ws-2", account)).toBe("local");
    expect(syncLabelOf("local")).toBe("On this device");
  });

  it("says nothing when there is no answer", () => {
    expect(syncStateOf("ws-1", null)).toBe("unknown");
    expect(syncLabelOf("unknown")).toBeNull();
  });
});
