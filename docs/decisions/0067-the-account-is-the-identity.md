# ADR-0067: The account is the identity, and the key is plumbing

- **Status:** proposed
- **Date:** 2026-10-25
- **Related:** [ADR-0065](./0065-accounts-own-workspaces.md) (an organization owns many workspaces), [ADR-0045](./0045-handbook-articles-are-cards.md), `docs/security-model.md`, `apps/canvas/src/session/ownerKey.ts`, `apps/canvas/src/session/recoveryWords.ts`, `apps/canvas/src/session/ownerKit.ts`, `apps/canvas/src/components/WorkspaceProtected.tsx`, `apps/canvas/src/components/StoragePanel.tsx`

## Context

A workspace is protected today by a **32-byte owner key** in `localStorage`, and the product asks
people to look after it in four different spellings:

| Artifact | What it is | What a reader thinks it is |
| --- | --- | --- |
| Owner key | the credential the relay verifies for writes | an internal detail they meet at a 409 |
| Recovery words | 24 BIP-39-shaped words that encode **the same key** | "my password", or a second password |
| `.suitekey` file | JSON holding **the same key again** | a licence file, or an export |
| Passphrase | PBKDF2 over words + workspace id, which **silently rotates the key** and invalidates old links and `.suitekey` files | "the same key, typed differently" — and it breaks the other three without saying so |

`docs/roadmap/alpha.md` §10.2 already records the conclusion: *"five terms for three artifacts;
'recovery words' and 'passphrase' sound layered but are alternative keys"*. This is not a copy problem.
Four names for one secret, one of which destroys the rest, cannot be explained into usability.

The identity layer that just landed ([ADR-0065](./0065-accounts-own-workspaces.md)) makes the fix
available: a workspace belongs to an **organization**, the `workspaces` row's primary key *is* the
document id, and claiming one is an `UPDATE` of `organization_id` that changes no id and breaks no
share link.

## Decision

**The account is the identity. The key stays as transport, and stops being something a person keeps.**

1. **Accounts are the front door; the owner key is plumbing.** A workspace belongs to an organization.
   The key remains the credential the relay verifies, and is never named, copied or pasted by a reader
   in the normal flow.
2. **Claim on sign-in, not on launch.** A device with no account is local-only and says so quietly.
   Signing in claims the workspaces this device already holds — one `UPDATE`, same ids, same URLs, same
   share links — because that is the property [ADR-0065](./0065-accounts-own-workspaces.md) §2 bought.
3. **Import works with no account.** A `.suite` backup imports into the device and is fully usable
   offline. Everything that involves a second party or a bill — sync, collaboration, shares, publishing,
   billing — needs the account. *"Import your work. Sign in for more."* is the whole onboarding.
4. **The passphrase path is deleted**, UI and all. It is the artifact that invalidates the others.
5. **Recovery words leave the product as a concept.** The encoder stays in the codebase
   (`recoveryWords.ts`) and is surfaced only as an advanced **owner export** beside `.suitekey`, under
   one name: *Owner file*. One artifact, one word, off the main path, for self-hosters who deliberately
   keep no account. A forgotten credential is the account's job — magic link, passkey, provider login —
   and an owner key is never described as a password.
6. **The storage conditions become a ladder, not a badge.** `StoragePanel` currently reports
   *"Best-effort"*, which is our internal model leaking. Four rungs, in the reader's words:
   - signed in and persisted → **nothing at all**
   - no account, persisted → one quiet, non-interactive line in the storage panel: *"Saved on this device"*
   - no account, not durable → one inline dismissible banner: *"This browser may clear your work. Sign in to keep it."* with a single action
   - storage failing right now (quota, denied write) → the only blocking dialog in the product

   Words like *durable storage*, *eviction* and *quota* live in the panel's detail row, never in the
   primary sentence.
7. **Registration is open, admission is reviewed.** Better Auth has no "registered but not yet admitted"
   state, so it is ours and it is small: an `admittedAt` field on the user (not a role — the org-wide
   `owner/admin/member` set that `capabilitiesForRole` reads must stay four values), and **one**
   `hooks.before` gate that refuses exactly three things while it is null: creating an organization,
   claiming a workspace, and opening a sync connection. Local editing, import and export are not
   privileges we grant. The refusal has one sentence: *"You're on the list. We'll email you when your
   workspace is ready."*
8. **An anonymous session exists only where a server exists.** Better Auth's `anonymous` plugin gives a
   session with no PII, and `onLinkAccount` fires on sign-up — that callback moves the anonymous
   organization's workspaces to the real account *before* Better Auth deletes the anonymous user. A
   purely local install never gets a session and simply stays on rung two.
9. **The front door is protected by normalization first, blocking second.** `better-auth-harmony`
   normalizes emails (`foo+temp@gmail.com` → `foo@gmail.com`) and blocks 55k disposable domains;
   normalization is the half that matters, because per-seat billing makes a duplicate account a
   duplicate seat. An invisible Cloudflare Turnstile challenge (official `captcha` + the
   `better-auth-captcha` client half) sits in front of it, because an operator reviews the queue by hand.
   `@dymo-api/better-auth` is the documented fallback if `validator.js` proves hostile to our Vitest
   node project.
10. **Invitations come from the organization plugin; invite keys come from `better-enrollment`.**
    Email-bound invitations are the plugin's `invitation`; shareable, capped, revocable keys are
    `better-enrollment`'s public invites. Our `invite_keys` table, `redeem_invite_key()` SQL function and
    bespoke redemption route are **deleted**. Guardrails, because this is community code touching who
    joins a tenant: pin the version, wrap redemption in our own tested route, keep `beforeAddMember` as
    the only seat gate, and always write the full role set (Better Auth stores roles as one
    comma-separated string, and a bare `setRole` strips invite-granted ones).
11. **Sign-in methods are passkeys, magic link and Google**, with `last-login-method` remembering the
    last one used so the screen can offer *"continue with your passkey"* instead of four equal buttons.
    `2fa` is available to operators and org owners, not to everyone.

## Consequences

- **The confusing artifact set disappears.** One credential a person never sees, one recovery path that
  is the account's, one advanced owner file for self-hosters.
- **Nothing about local-first weakens.** The document is still IndexedDB, still offline, still
  exportable forever; the account decides who it is shared with, not whether it can be opened.
- **The claim step is cheap and reversible.** If a reader never signs in, nothing on their disk changes.
- **`WorkspaceProtected` shrinks** to a single question ("sign in to this workspace, or open an owner
  file") instead of five stacked recovery concepts.
- **Deleting the passphrase removes an invalidation trap** that silently broke links and key files.
- **Admission adds one state to reason about**, and the honest cost is that a new account cannot
  collaborate until an operator clicks admit. That is the price of an open front door with a small
  licensed cohort, and it is one field plus one hook rather than a queue product.
- **Risk: `better-enrollment` is community code** with a role-string footgun. Mitigated by the pin, the
  wrapper and a single role reader, not by optimism.

## Rejected alternatives

- **Keep the recovery words as "the" recovery story.** They are a second password that protects nothing
  the account does not already protect, and they are the reason four names exist for one key.
- **Keep the passphrase as an advanced option.** It rotates the key, which invalidates links and files
  a reader has already saved; an advanced option that breaks the other options is a support queue.
- **Require an account for local editing.** It breaks the promise the product is built on, and it makes
  "import your work" a lie.
- **Gate admission with a role.** `capabilitiesForRole` reads `owner/admin/member` org-wide; a
  `pending` role would have to be understood by every capability check, and Better Auth's role field is
  already a comma-separated string that invites merge bugs.
- **Block the whole app while pending.** Local-first is not a privilege; the gate goes where value
  leaves the device — organizations, claims, sync.
- **A bespoke waitlist product** (forms, emails, a second database). One field, one hook, one queue.
