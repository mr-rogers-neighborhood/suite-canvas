/**
 * Passkey sign-in, using the browser's own WebAuthn API.
 *
 * `@better-auth/passkey`'s client half would do this for us, but it arrives with
 * `@simplewebauthn/browser`, and the client is allowed exactly one new
 * dependency. The ceremony itself is three steps and belongs to the platform:
 * ask the server for a challenge, hand it to `navigator.credentials.get`, and
 * post the signed assertion back. Everything the server verifies — the signature,
 * the challenge, the origin, the counter — is verified *there*; this file only
 * encodes bytes, and the encoding is public-credential JSON, not a scheme of ours.
 *
 * Errors are named, because "it did not work" is the wrong thing to tell someone
 * whose passkey prompt they just dismissed.
 */

/** The options Better Auth's `/passkey/generate-authenticate-options` returns. */
export interface PasskeyRequestOptions {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: readonly { id: string; type?: PublicKeyCredentialType }[];
}

/** The public-credential JSON the passkey server verifies. */
export interface PasskeyAssertion {
  id: string;
  rawId: string;
  type: string;
  authenticatorAttachment?: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
}

export type PasskeyFailure =
  | "cancelled"
  | "unsupported"
  | "unavailable"
  | "not-registered"
  | "unknown";

export type PasskeyResult = { ok: true } | { ok: false; failure: PasskeyFailure; message: string };

const MESSAGES: Record<PasskeyFailure, string> = {
  cancelled: "That passkey prompt was dismissed. Nothing changed here.",
  unsupported: "This browser cannot use passkeys. Use a magic link instead.",
  unavailable: "The account service did not answer. Your work here is untouched.",
  "not-registered": "No passkey on this device is registered to an account here.",
  unknown: "That passkey could not be checked. Try a magic link instead.",
};

export function passkeyFailure(
  failure: PasskeyFailure,
  message: string = MESSAGES[failure],
): { ok: false; failure: PasskeyFailure; message: string } {
  return { ok: false, failure, message };
}

/** UUID-shaped credential ids are base64url; the DOM needs bytes. */
export function base64UrlToBytes(value: string): Uint8Array {
  const normalised = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalised.padEnd(normalised.length + ((4 - (normalised.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The inverse, because `clientDataJSON` and the signature travel as text. */
export function bytesToBase64Url(buffer: ArrayBuffer | null | undefined): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/** `navigator.credentials.get` wants `ArrayBuffer`s; the server sends text. */
export function toPublicKeyRequest(
  options: PasskeyRequestOptions,
): PublicKeyCredentialRequestOptions {
  const allowCredentials = (options.allowCredentials ?? []).map((entry) => ({
    type: entry.type ?? "public-key",
    id: base64UrlToBytes(entry.id) as BufferSource,
  }));
  return {
    challenge: base64UrlToBytes(options.challenge) as BufferSource,
    ...(options.rpId ? { rpId: options.rpId } : {}),
    ...(options.timeout ? { timeout: options.timeout } : {}),
    userVerification: options.userVerification ?? "preferred",
    ...(allowCredentials.length > 0 ? { allowCredentials } : {}),
  };
}

/** The assertion as JSON, which is the shape the passkey server verifies. */
export function assertionJson(credential: PublicKeyCredential): PasskeyAssertion | null {
  // Structural rather than `instanceof`: the contract is public-credential JSON,
  // and the DOM class is absent in a test environment (and in some embeds).
  const response = credential.response as Partial<AuthenticatorAssertionResponse> | undefined;
  if (!response?.clientDataJSON || !response.authenticatorData || !response.signature) return null;
  const attachment = credential.authenticatorAttachment;
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    ...(attachment ? { authenticatorAttachment: attachment } : {}),
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      authenticatorData: bytesToBase64Url(response.authenticatorData),
      signature: bytesToBase64Url(response.signature),
      userHandle: response.userHandle ? bytesToBase64Url(response.userHandle) : null,
    },
  };
}

export interface PasskeyDeps {
  /** `GET /passkey/generate-authenticate-options`; `null` when the server refused. */
  requestOptions: () => Promise<PasskeyRequestOptions | null>;
  /** `POST /passkey/verify-authentication` with `{ response }`. */
  verify: (assertion: PasskeyAssertion) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** `navigator.credentials`, injected so the ceremony is testable. */
  credentials?: Pick<CredentialsContainer, "get"> | undefined;
}

export async function signInWithPasskey(deps: PasskeyDeps): Promise<PasskeyResult> {
  const credentials =
    deps.credentials ?? (typeof navigator === "undefined" ? undefined : navigator.credentials);
  if (!credentials || typeof PublicKeyCredential === "undefined") {
    return passkeyFailure("unsupported");
  }

  let options: PasskeyRequestOptions | null;
  try {
    options = await deps.requestOptions();
  } catch {
    return passkeyFailure("unavailable");
  }
  if (options === null) return passkeyFailure("unavailable");
  if (!options.allowCredentials || options.allowCredentials.length === 0) {
    // No credential is registered here, so there is no prompt worth opening.
    return passkeyFailure("not-registered");
  }

  let credential: Credential | null;
  try {
    credential = (await credentials.get({
      publicKey: toPublicKeyRequest(options),
    })) as Credential | null;
  } catch (cause) {
    const name = cause instanceof DOMException ? cause.name : "";
    if (name === "NotAllowedError" || name === "AbortError") return passkeyFailure("cancelled");
    if (name === "SecurityError") {
      return passkeyFailure("unknown", "This origin cannot use passkeys. Try a magic link.");
    }
    return passkeyFailure("unknown");
  }
  if (credential === null) return passkeyFailure("cancelled");

  const assertion = assertionJson(credential as PublicKeyCredential);
  if (assertion === null) {
    return passkeyFailure("unknown", "This browser answered with an unsupported credential.");
  }

  try {
    const verified = await deps.verify(assertion);
    return verified.ok ? { ok: true } : passkeyFailure("unknown", verified.message);
  } catch {
    return passkeyFailure("unavailable");
  }
}
