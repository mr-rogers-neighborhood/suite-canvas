import { describe, expect, it } from "vitest";
import { readSyncRefusal } from "./syncAccess";

const session = async () => ({ authorization: "Bearer t" });

function answer(body: unknown, status = 200): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
}

const ask = (fetch: typeof globalThis.fetch) =>
  readSyncRefusal({
    workspaceId: "ws-1",
    base: "https://relay.test",
    fetch,
    authorization: session,
  });

describe("asking the relay why", () => {
  it("reads the relay's own reason into something a reader can act on", async () => {
    expect(await ask(answer({ ok: false, reason: "session-invalid" }))).toBe("session");
    expect(await ask(answer({ ok: false, reason: "licence-expired" }))).toBe("plan");
    expect(await ask(answer({ ok: false, reason: "workspace-owned-elsewhere" }))).toBe("elsewhere");
    expect(await ask(answer({ ok: false, reason: "organization-required" }))).toBe("unknown");
    // The door's two answers. They are separate names because they are separate
    // sentences: "choose a plan" and "your plan does not cover another workspace".
    expect(await ask(answer({ ok: false, reason: "plan-required" }))).toBe("plan");
    expect(await ask(answer({ ok: false, reason: "workspace-limit" }))).toBe("limit");
  });

  it("is silent when the connection would be allowed", async () => {
    expect(await ask(answer({ ok: true, permission: "write" }))).toBeNull();
  });

  it("is silent rather than guessing at a reason it does not know", async () => {
    expect(await ask(answer({ ok: false, reason: "something-new" }))).toBe("unknown");
    expect(await ask(answer({ ok: false }))).toBeNull();
  });

  it("is silent when there is no session to ask with", async () => {
    const result = await readSyncRefusal({
      workspaceId: "ws-1",
      fetch: answer({ ok: false, reason: "session-invalid" }),
      authorization: async () => ({}),
    });
    expect(result).toBeNull();
  });

  it("is silent when the relay cannot be reached", async () => {
    const fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;
    expect(await ask(fetch)).toBeNull();
  });
});
