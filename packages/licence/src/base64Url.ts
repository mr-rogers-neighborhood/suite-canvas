/** Base64url alphabet, no padding; a segment outside it is a malformed token. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Decodes one token segment, or null when it is not canonical base64url.
 * Re-encoding rejects non-canonical input such as trailing garbage bits.
 */
export function decodeBase64Url(segment: string): Buffer | null {
  if (segment.length === 0 || !BASE64URL.test(segment)) return null;
  const bytes = Buffer.from(segment, "base64url");
  return bytes.length > 0 && bytes.toString("base64url") === segment ? bytes : null;
}
