/**
 * The relay's two environment reads. Everything else in this package is pure.
 *
 * True only on the hosted relay. Every licence code path is inert without it,
 * so a self-host can never be asked for a key, and never parses one.
 */
export function licenceRequired(): boolean {
  return process.env.SUITE_HOSTED === "1";
}

/** Configured verification key, or null when the relay has none. */
export function licencePublicKey(): string | null {
  if (!licenceRequired()) return null;
  const value = process.env.SUITE_LICENCE_PUBLIC_KEY?.trim();
  return value && value.length > 0 ? value : null;
}
