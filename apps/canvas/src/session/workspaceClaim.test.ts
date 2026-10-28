import { describe, expect, it } from "vitest";
import { CLAIM_PATH, claimWorkspaceForAccount } from "./workspaceClaim";

const session = async () => ({ authorization: "Bearer t" });

function answer(status: number, body: unknown): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
}

describe("claiming a workspace for the account", () => {
  it("posts the workspace and its name, on the page's own origin", async () => {
    let seen = "";
    let sent: unknown = null;
    const fetch = (async (url: string, init: RequestInit) => {
      seen = url;
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, status: "claimed" }), { status: 201 });
    }) as unknown as typeof globalThis.fetch;

    expect(
      await claimWorkspaceForAccount({
        workspaceId: "ws-1",
        name: "Reading",
        base: "https://app.suite.run",
        fetch,
        authorization: session,
      }),
    ).toBe("claimed");
    expect(seen).toBe(`https://app.suite.run${CLAIM_PATH}`);
    expect(sent).toEqual({ workspaceId: "ws-1", name: "Reading" });
  });

  it("reports a workspace the plan does not cover, rather than failing", async () => {
    const outcome = await claimWorkspaceForAccount({
      workspaceId: "ws-1",
      fetch: answer(403, { ok: false, error: "seat-refused", message: "…" }),
      authorization: session,
    });
    expect(outcome).toBe("capped");
  });

  // The hosted wall: a new account's licence grants no workspace, so this is the
  // first answer anybody gets. Each of these once fell through to `unavailable`,
  // which the shell reads as "no answer yet" — so the badge stayed blank and the
  // only thing left to report was the socket's refusal, verbatim.
  for (const [status, error] of [
    [402, "plan-required"],
    [403, "workspace-limit"],
  ] as const) {
    it(`treats ${error} as the plan being the obstacle, not as no answer`, async () => {
      const outcome = await claimWorkspaceForAccount({
        workspaceId: "ws-1",
        fetch: answer(status, { ok: false, error, message: "…" }),
        authorization: session,
      });
      expect(outcome).toBe("capped");
    });
  }

  it("reports a workspace another account holds", async () => {
    const outcome = await claimWorkspaceForAccount({
      workspaceId: "ws-1",
      fetch: answer(409, { ok: false, error: "workspace-already-claimed" }),
      authorization: session,
    });
    expect(outcome).toBe("elsewhere");
  });

  it("is unavailable with no session, without asking", async () => {
    let called = false;
    const fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    expect(
      await claimWorkspaceForAccount({
        workspaceId: "ws-1",
        fetch,
        authorization: async () => ({}),
      }),
    ).toBe("unavailable");
    expect(called).toBe(false);
  });

  it("is unavailable when minting the credential throws", async () => {
    const outcome = await claimWorkspaceForAccount({
      workspaceId: "ws-1",
      fetch: answer(200, { ok: true }),
      authorization: async () => {
        throw new Error("no session");
      },
    });
    expect(outcome).toBe("unavailable");
  });

  it("is unavailable when the request never leaves", async () => {
    const fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;
    expect(
      await claimWorkspaceForAccount({ workspaceId: "ws-1", fetch, authorization: session }),
    ).toBe("unavailable");
  });
});
