import { exportJWK, type GenerateKeyPairResult, generateKeyPair, SignJWT } from "jose";
import { createSessionVerifier, type SessionVerifier } from "./sessionToken.js";

/**
 * A signing side for the session tests: an Ed25519 key pair, a key set served
 * through the verifier's `fetch` seam, and a way to mint tokens.
 *
 * It exists so the tests exercise the real verifier — signature check, `iss`,
 * `aud`, clock, claim narrowing, cache refetch — without a socket or a control
 * plane, and so a rotation can be simulated the way a real one arrives: a new
 * `kid` the cache has never seen.
 */

const KID = "suite-session-test-key";

interface ServedKeys {
  kid: string;
  jwk: Record<string, unknown>;
}

export interface SignOverrides {
  /** `sub`; defaults to `user-1`. */
  subject?: string;
  /** `org`; defaults to `org-a`. Set null for a personal session. */
  organizationId?: string | null;
  role?: string | null;
  tier?: string;
  limits?: Record<string, number>;
  /** Seconds added to `exp`; negative mints an expired token. */
  expiresInSeconds?: number;
  /** Overrides `iss`, for the wrong-issuer case. */
  issuer?: string;
  /** Overrides `aud`, for the wrong-audience case. */
  audience?: string;
  /** Signs with a key no served key set contains. */
  foreignKey?: boolean;
}

export interface SessionFixtureOptions {
  authUrl?: string;
  cacheMaxAge?: number;
  cooldown?: number;
}

export interface SessionFixture {
  authUrl: string;
  verifier: SessionVerifier;
  /** Mints a token the verifier accepts unless an override says otherwise. */
  sign: (overrides?: SignOverrides) => Promise<string>;
  /** How many key-set fetches the verifier has made. */
  fetches: () => number;
  /** A token signed with the key the fixture first served, before any rotation. */
  signWithOriginalKey: (overrides?: SignOverrides) => Promise<string>;
  /** Replaces the served key set with a new key and `kid`, as a rotation would. */
  rotate: () => Promise<void>;
}

export async function createSessionFixture(
  options: SessionFixtureOptions = {},
): Promise<SessionFixture> {
  const authUrl = options.authUrl ?? "http://localhost:1236";
  type KeyPair = GenerateKeyPairResult;
  let current: { keys: KeyPair; kid: string } = {
    keys: await generateKeyPair("EdDSA", { crv: "Ed25519" }),
    kid: KID,
  };
  let foreign: KeyPair | null = null;
  let served: ServedKeys | null = null;
  let fetches = 0;

  const publish = async (keys: KeyPair, kid: string): Promise<void> => {
    const jwk = await exportJWK(keys.publicKey);
    served = { kid, jwk: { ...jwk, kid, alg: "EdDSA", use: "sig" } };
  };
  const original = current;
  await publish(current.keys, current.kid);

  const verifier = createSessionVerifier({
    authUrl,
    ...(options.cacheMaxAge === undefined ? {} : { cacheMaxAge: options.cacheMaxAge }),
    ...(options.cooldown === undefined ? {} : { cooldown: options.cooldown }),
    fetch: async () => {
      fetches += 1;
      const current = served;
      if (current === null) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({ keys: [current.jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const mint = async (
    signingKey: GenerateKeyPairResult["privateKey"],
    kid: string,
    overrides: SignOverrides,
  ): Promise<string> => {
    const organization =
      overrides.organizationId === undefined ? "org-a" : overrides.organizationId;
    const issuer = overrides.issuer ?? authUrl;
    return new SignJWT({
      org: organization,
      role: overrides.role === undefined ? "member" : overrides.role,
      tier: overrides.tier ?? "team",
      limits: overrides.limits ?? {
        workspaces: 3,
        documentBytes: 1_000_000,
        attachmentBytes: 1_000_000,
      },
    })
      .setProtectedHeader({ alg: "EdDSA", kid, typ: "JWT" })
      .setSubject(overrides.subject ?? "user-1")
      .setIssuer(issuer)
      .setAudience(overrides.audience ?? authUrl)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + (overrides.expiresInSeconds ?? 300))
      .sign(signingKey);
  };

  return {
    authUrl,
    verifier,
    fetches: () => fetches,
    signWithOriginalKey: (overrides = {}) =>
      mint(original.keys.privateKey, original.kid, overrides),
    rotate: async () => {
      const keys = await generateKeyPair("EdDSA", { crv: "Ed25519" });
      current = { keys, kid: `${KID}-rotated` };
      await publish(keys, current.kid);
    },
    sign: async (overrides = {}) => {
      let signingKey = current.keys.privateKey;
      if (overrides.foreignKey === true) {
        foreign ??= await generateKeyPair("EdDSA", { crv: "Ed25519" });
        signingKey = foreign.privateKey;
      }
      return mint(signingKey, current.kid, overrides);
    },
  };
}
