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

    **A constraint found after this item was written.** `better-enrollment`'s redemption assumes
    passwords: its example config sets `emailAndPassword: { enabled: true, disableSignUp: true }`, a
    private invite "sets their password", and `invite.redeem` takes one — which conflicts with §11's
    "no passwords". Its **open mode** ("invitations become role and organization grants for self-serve
    sign-ups") is the path that may not need one, because the person signs up with a passkey or magic
    link first and redemption only grants membership. That must be proven before `invite_keys` are
    deleted, so they stay until it is. Adopting a plugin is not a reason to bring passwords back.

    **Resolved 2026-10-25: §11 is amended instead, and the keys are deleted.** The author took the
    other branch — an invited account may set a password (§11 amendment) — so the constraint above is
    no longer a blocker and `invite_keys`, `redeem_invite_key()` and the bespoke route are gone.

    Four things the adoption found that this item could not know, recorded because they change what
    "keep `beforeAddMember` as the only seat gate" means in practice:

    1. **The open-mode hypothesis was unnecessary, and would have been wrong.** In the plugin's
       `invite-only` mode, `invite/redeem` already routes a *shareable* invite presented by a
       signed-in person to `activate` — the mode's own `activate` endpoint is not the only door to
       it. Choosing `mode: "open"` would have removed the password path entirely (every redemption
       becomes a membership grant to an existing account), which is the opposite of what §11 now
       allows. So the configuration is `mode: "invite-only"` with `allowOpenSignup: true`: the
       per-email guarantee the plugin can keep, without the app-wide closure that §7 forbids.
    2. **`beforeAddMember` cannot see a redemption.** The plugin inserts its `member` row through
       the adapter, so no organization hook fires for it. `beforeAddMember` remains the only seat
       gate for member rows the *organization* plugin writes; the same licence decision reaches the
       plugin as `organization.resolveSeatLimit` (`seatCeiling` in `seats.ts`, which
       `checkSeatAllowance` also reads). One policy, two call sites — not a second policy.
    3. **A private invite pre-creates the account.** In `invite-only` mode the plugin writes a
       `user` row with `emailVerified: false` when the invitation is minted, and refuses to let that
       shell sign in by magic link. This is what makes "the invitation creates the account" true; it
       also means an invitation exists as a user row before anybody accepts it.
    4. **Redemption is rate-limited by the plugin** (5 attempts per minute per path), and by Better
       Auth's own limiter for `/sign-in/*` — both only when Better Auth's limiter is enabled, which
       is production by default. See the §11 amendment for why the password route is pinned
       explicitly.
11. **Sign-in methods are passkeys, magic link and Google**, with `last-login-method` remembering the
    last one used so the screen can offer *"continue with your passkey"* instead of four equal buttons.
    *Amended 2026-10-25: an account created by an invitation may also sign in with a password — see
    the amendment at the end of this item.*

    **Second factors are offered to everyone, and nudged by method rather than by role** (amended
    2026-10-25: the first cut restricted `2fa` to operators, which mistook a role for a risk model):

    - A **passkey is already multi-factor** — possession of the device plus a biometric or PIN — so for
      a passkey-only account a TOTP code is close to theatre. It still earns its place against *synced*
      passkeys (iCloud Keychain, Google Password Manager), where one compromised cloud account yields
      the key, which is a narrow but real threat.
    - A **magic link is one factor, and the mailbox is the entire account** — there is no password to
      reset, so the link *is* the reset path. An attacker with the mailbox takes the account unless a
      second factor stands in front of sign-in. This is where MFA earns its keep.
    - **Google** brings Google's own MFA, so ours adds little.

    So: the plugin is available to every account; the Security panel shows passkeys, one-time codes and
    live sessions in one place; the *nudge* is strongest for accounts whose only method is email, absent
    for Google-only, and neutral for passkey users. Operators are the one group where it is **required**
    rather than recommended, because they can impersonate (`admin`) and spend the organization's money
    (`authorizeReference`). Requirement is scoped by capability, never by "we think everyone should".

    **Amendment (2026-10-25): an invited account may set a password.** Adopting `better-enrollment`
    (§10) made "no passwords" cost more than it bought: the plugin's private invites *are* the
    email-bound invitation path, and their redemption sets a password. Rather than keep a parallel
    invite implementation to avoid one credential, the author reversed this item for one case.

    *The reasoning, because "just add a password" is how a security model rots.* The two cases are not
    the same shape. A **self-serve** account is a person signing themselves up for a product they have
    not been let into yet; a passkey is the right default there, because there is no prior relationship
    to lend trust and nothing to hand them. An **invited** account is a colleague joining somebody
    else's tenant: a person already exists outside the product, an owner inside it decided to add them,
    and the invitation link is how the two facts meet. Such a person may have no device that can hold a
    passkey, is often on a borrowed machine for the first hour, and was *told a password is how you get
    in* — asking them to enrol a passkey before they have ever seen the product is friction in the one
    flow where the product has already decided to trust them. So: self-serve sign-up stays closed
    (`emailAndPassword.disableSignUp`), and a password is reachable **only** by redeeming an
    invitation. The passwordless doors stay open to everyone.

    *Consequences, stated as obligations rather than reassurances:*

    - **Password sign-in is the one route here that can be brute-forced.** A magic link is useless
      after one use and a passkey cannot be guessed; a password can be sprayed. Rate limiting must
      therefore apply **to that route specifically**, not merely "somewhere in the stack". Better
      Auth already throttles `/sign-in/*` (3 attempts per 10 s) and `better-enrollment` throttles its
      redemption endpoints (5 per minute), both effective when Better Auth's limiter is on — which is
      the production default. The `/sign-in/email` rule is therefore pinned explicitly in
      `authOptions`, so a framework default changing cannot silently widen it. The limiter's storage
      is in-memory per instance; a deployment running more than one instance must point it at a
      shared store, or the throttle is per instance rather than per attacker.
    - **`SignInMethod` gains `"password"`,** and `mfaAdvice` treats it like a magic link —
      *recommended*, one factor — because the realistic attacks are the same shape: a secret that is
      one thing, repeated elsewhere, phishable, and now guessable too. It is not "required": the
      requirement stays scoped to capability (impersonation, spending), as above.
    - **A password can be reset, and a magic link cannot be un-sent.** Password reset becomes a real
      path for these accounts, so the reset flow inherits the same obligation: rate limited, and never
      a way to bypass admission.
    - **Nothing about the identity model changes.** The password is one more way to prove the same
      account; it is not a second account, and it does not touch the owner key, the organization or
      the capability matrix.

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
- **Risk: passwords are now a credential this product holds**, for exactly the accounts an invitation
  created (see the §11 amendment). The cost is a brute-forceable route that must stay rate-limited and
  a reset path that must never bypass admission; the alternative was a second invitation
  implementation whose maintenance cost fell on us.

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
