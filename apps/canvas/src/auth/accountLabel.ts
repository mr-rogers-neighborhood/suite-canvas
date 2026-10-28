import type { AccountSummary } from "./useAccountStore";

/**
 * What to call an account on screen.
 *
 * An anonymous session is minted by the account service with a generated address on a
 * placeholder domain — `amtzlga0jmzd9omq6itlpb9mudjkvrrj@anonymous.placeholder.invalid` —
 * which is a credential's internal detail, not a name. It appeared in the app bar because
 * the chip read `email` first, and thirty-two random characters in a menu bar is worse
 * than no label at all: it tells the reader nothing about who they are and cannot be read
 * out loud.
 *
 * So the order is a name, then an address a person could recognise, then "Anonymous".
 * Every surface that names an account asks here, so the bar, the panel and the members
 * list cannot disagree about the same session.
 */
const PLACEHOLDER_EMAIL = /@anonymous\.placeholder\.invalid$/iu;

/** True for the generated address an anonymous session carries. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && PLACEHOLDER_EMAIL.test(email.trim());
}

export function accountLabel(
  account: Pick<AccountSummary, "name" | "email"> | null | undefined,
  fallback = "Anonymous",
): string {
  if (!account) return fallback;
  const name = account.name?.trim() ?? "";
  if (name.length > 0) return name;
  const email = account.email?.trim() ?? "";
  if (email.length > 0 && !isPlaceholderEmail(email)) return email;
  return fallback;
}
