import { describe, expect, it } from "vitest";
import { probeAuth } from "./availability";

/** A `Response` stand-in: jsdom has no fetch, and the probe only reads two fields. */
function answer(input: { ok: boolean; body?: unknown; json?: () => Promise<unknown> }): Response {
  return {
    ok: input.ok,
    json: input.json ?? (async () => input.body),
  } as Response;
}

const base = "https://accounts.example/api/auth";

describe("auth availability", () => {
  it("is available only when the deployment answers Better Auth's ok", async () => {
    const seen: string[] = [];
    const result = await probeAuth({
      base,
      fetch: (async (url: string) => {
        seen.push(String(url));
        return answer({ ok: true, body: { ok: true } });
      }) as unknown as typeof fetch,
    });
    expect(result).toBe("available");
    expect(seen).toEqual(["https://accounts.example/api/auth/ok"]);
  });

  it("is unavailable when a static host serves its index page", async () => {
    // A dev server answers unknown paths with HTML and status 200. Offering a
    // magic-link form there would be a lie with a cursor.
    const result = await probeAuth({
      base,
      fetch: (async () =>
        answer({
          ok: true,
          json: async () => {
            throw new SyntaxError("Unexpected token <");
          },
        })) as unknown as typeof fetch,
    });
    expect(result).toBe("unavailable");
  });

  it("is unavailable when the control plane is switched off", async () => {
    const result = await probeAuth({
      base,
      fetch: (async () =>
        answer({
          ok: false,
          body: { ok: false, error: "auth-not-configured" },
        })) as unknown as typeof fetch,
    });
    expect(result).toBe("unavailable");
  });

  it("is unavailable when the request fails outright", async () => {
    const result = await probeAuth({
      base,
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });
    expect(result).toBe("unavailable");
  });

  it("is unavailable when the body is not the shape Better Auth promises", async () => {
    for (const body of [null, "ok", { ok: "yes" }, { status: "up" }]) {
      const result = await probeAuth({
        base,
        fetch: (async () => answer({ ok: true, body })) as unknown as typeof fetch,
      });
      expect(result).toBe("unavailable");
    }
  });

  it("does not hang on a server that never answers", async () => {
    const result = await probeAuth({
      base,
      timeoutMs: 5,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        })) as unknown as typeof fetch,
    });
    expect(result).toBe("unavailable");
  });
});
