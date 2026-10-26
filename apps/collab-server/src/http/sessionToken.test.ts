import { describe, expect, it } from "vitest";
import { createSessionFixture } from "./sessionFixture.js";
import { looksLikeSessionToken, normaliseAuthUrl } from "./sessionToken.js";

/**
 * The verifier is the trust boundary for every account connection: if it accepts
 * something it should not, a room opens; if it refuses something it should
 * accept, editing stops. These cases pin both directions, and the cache
 * behaviour that keeps a rotation from becoming an outage.
 */

describe("createSessionVerifier", () => {
  it("accepts a token the control plane signed and narrows it to the claims the relay reads", async () => {
    const fixture = await createSessionFixture();
    const token = await fixture.sign({ role: "admin", limits: { documentBytes: 42 } });

    const verified = await fixture.verifier.verify(token);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims).toMatchObject({
      userId: "user-1",
      organizationId: "org-a",
      role: "admin",
      tier: "team",
      limits: { documentBytes: 42 },
    });
    expect(verified.claims.expiresAt).toBeGreaterThan(Date.now());
  });

  it("keeps a personal session's missing organization as null", async () => {
    const fixture = await createSessionFixture();
    const verified = await fixture.verifier.verify(
      await fixture.sign({ organizationId: null, role: null }),
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims.organizationId).toBeNull();
    expect(verified.claims.role).toBeNull();
  });

  it("refuses a token signed by a key the set does not hold", async () => {
    const fixture = await createSessionFixture();
    await expect(
      fixture.verifier.verify(await fixture.sign({ foreignKey: true })),
    ).resolves.toEqual({ ok: false, reason: "signature" });
  });

  it("refuses the wrong issuer or audience", async () => {
    const fixture = await createSessionFixture();
    await expect(
      fixture.verifier.verify(await fixture.sign({ issuer: "https://evil.example" })),
    ).resolves.toEqual({ ok: false, reason: "signature" });
    await expect(
      fixture.verifier.verify(await fixture.sign({ audience: "https://evil.example" })),
    ).resolves.toEqual({ ok: false, reason: "signature" });
  });

  it("refuses an expired token and a payload it cannot narrow", async () => {
    const fixture = await createSessionFixture();
    await expect(
      fixture.verifier.verify(await fixture.sign({ expiresInSeconds: -60 })),
    ).resolves.toEqual({ ok: false, reason: "expired" });
    // A tier is the entitlement; a token without one is not an entitlement.
    await expect(fixture.verifier.verify(await fixture.sign({ tier: " " }))).resolves.toEqual({
      ok: false,
      reason: "claims",
    });
    await expect(
      fixture.verifier.verify(await fixture.sign({ role: "superuser" })),
    ).resolves.toEqual({ ok: false, reason: "claims" });
  });

  it("refuses anything that is not a compact JWS without touching the network", async () => {
    const fixture = await createSessionFixture();
    for (const value of ["", "share-token", "a.b", "a.b.c.d"]) {
      expect(looksLikeSessionToken(value)).toBe(false);
      await expect(fixture.verifier.verify(value)).resolves.toEqual({
        ok: false,
        reason: "malformed",
      });
    }
    expect(fixture.fetches()).toBe(0);
  });

  it("fetches the key set once and then verifies from the cache", async () => {
    const fixture = await createSessionFixture();
    const first = await fixture.sign();
    const second = await fixture.sign({ subject: "user-2" });

    expect((await fixture.verifier.verify(first)).ok).toBe(true);
    expect((await fixture.verifier.verify(second)).ok).toBe(true);
    expect(fixture.fetches()).toBe(1);
  });

  it("refuses an unknown key id inside the cooldown instead of fetching per join", async () => {
    const fixture = await createSessionFixture();
    await fixture.verifier.verify(await fixture.signWithOriginalKey());
    await fixture.rotate();

    // Within the cooldown window the answer is a refusal, not a fetch storm; the
    // next join after it refetches (see the case below, and the cache age).
    await expect(fixture.verifier.verify(await fixture.sign())).resolves.toMatchObject({
      ok: false,
    });
    expect(fixture.fetches()).toBe(1);
  });

  it("keeps verifying with a cached key after a rotation, until the cache ages", async () => {
    const fixture = await createSessionFixture();
    expect((await fixture.verifier.verify(await fixture.sign())).ok).toBe(true);

    await fixture.rotate();
    // The old key is gone from the published set, but it is still in the cache:
    // a rotation is not an outage for tokens already in flight. Key removal is
    // bounded by the cache lifetime rather than by a failed connection.
    await expect(
      fixture.verifier.verify(await fixture.signWithOriginalKey()),
    ).resolves.toMatchObject({ ok: true });
    expect(fixture.fetches()).toBe(1);
  });

  it("refetches when the token names a key id the cache has never seen", async () => {
    // The cooldown is what stops a forged `kid` from hammering the control
    // plane; with it out of the way, an unknown id is a fetch on the next join.
    const fixture = await createSessionFixture({ cooldown: 0 });
    await fixture.verifier.verify(await fixture.signWithOriginalKey());
    expect(fixture.fetches()).toBe(1);

    // A rotation publishes a new key under a new `kid`; the cache cannot satisfy
    // it, so the verifier refetches once and accepts the new signature.
    await fixture.rotate();
    await expect(fixture.verifier.verify(await fixture.sign())).resolves.toMatchObject({
      ok: true,
    });
    expect(fixture.fetches()).toBe(2);
  });

  it("refetches after the cache ages out, so a rotation is not an outage", async () => {
    const fixture = await createSessionFixture({ cacheMaxAge: 0, cooldown: 0 });
    await fixture.verifier.verify(await fixture.sign());
    await fixture.rotate();
    await fixture.verifier.verify(await fixture.sign());
    expect(fixture.fetches()).toBeGreaterThanOrEqual(2);
  });

  it("reloads on demand, for a caller that wants a warm cache at boot", async () => {
    const fixture = await createSessionFixture();
    await fixture.verifier.refresh();
    expect(fixture.fetches()).toBe(1);
    expect((await fixture.verifier.verify(await fixture.sign())).ok).toBe(true);
    expect(fixture.fetches()).toBe(1);
  });
});

describe("normaliseAuthUrl", () => {
  it("keeps the origin and drops a trailing path or slash", () => {
    expect(normaliseAuthUrl("https://accounts.example.com/")).toBe("https://accounts.example.com");
    expect(normaliseAuthUrl(" http://localhost:1236 ")).toBe("http://localhost:1236");
    expect(normaliseAuthUrl("https://accounts.example.com/api/auth")).toBe(
      "https://accounts.example.com",
    );
  });

  it("returns null for an unset or unusable value", () => {
    expect(normaliseAuthUrl(undefined)).toBeNull();
    expect(normaliseAuthUrl("  ")).toBeNull();
    expect(normaliseAuthUrl("not-a-url")).toBeNull();
  });
});
