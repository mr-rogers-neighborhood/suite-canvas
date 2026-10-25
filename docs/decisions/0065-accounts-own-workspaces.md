# ADR-0065: Accounts own workspaces, invite keys bring people in, billing is open

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0022](./0022-share-projection-links.md) (share projection links),
  [ADR-0021](./0021-sharing-seam-deferred.md) (the sharing seam),
  [ADR-0041](./0041-alpha-core-is-a-closed-feature-set.md) (the closed core list),
  [security-model.md](../security-model.md), [billing.md](../billing.md),
  [roadmap/beta.md](../roadmap/beta.md) (B6, A5), [roadmap/v1.md](../roadmap/v1.md) (V1-9…V1-17),
  `apps/canvas/src/session/ownerKey.ts`, `services/billing/handler.ts`,
  `apps/collab-server/src/licence.ts`

## Context

Everything that identifies a person today is a **capability**: a 32-byte owner key in the URL fragment
and in `localStorage`, a workspace editor token, a workspace viewer token, and a `.suitekey` file for
recovery. It works, it is genuinely local-first, and it has three costs that keep showing up:

1. **There is no "me".** A person with three browsers has three chances to lose the one secret that
   protects their work, and no way to see or revoke the others. beta.md's B6 promises either accounts
   or a written operator-recovery runbook precisely because this is the worst support scenario.
2. **There is no way to invite a specific person.** A capability link invites *whoever opens it,
   forever*. That is the right primitive for sharing an artefact and the wrong one for "add my tester
   to this workspace with edit rights until Friday."
3. **There is no way to charge.** [billing.md](../billing.md) has a real Stripe webhook — signature
   check, event claim, Ed25519 licence mint, SES delivery, an optional DynamoDB store — and it is
   behind `SUITE_BILLING_ENABLED=0`. What is missing is not durability, it is a *front door*: nothing
   in the app can start a checkout, because the handler has never read `STRIPE_SECRET_KEY`.

beta.md currently resolves this by taking the **capability-link branch**: accounts are optional and may
not ship in Beta, Better Auth is V1-9…V1-12, and "Beta does not claim both". The author now wants the
other branch sooner — testers need sync, and the product should be able to charge from the start.

## Decision

**Hybrid identity: capability links stay, ownership moves to accounts, invitations are rows, and the
licence remains the only entitlement.**

1. **An account owns workspaces; a link shares them.** Better Auth on a control plane
   (passkeys, magic link, Google — V1-9) issues a session cookie for the app origin. An **owned
   workspace** is one whose `ownerUserId` is set; an **anonymous workspace** has none and keeps working
   exactly as it does today. Both can be shared; only an owned one can be billed or have members.
2. **Claiming keeps the identity of the work.** An anonymous workspace can be claimed by a signed-in
   account without changing its id, its placements, or any share link already handed out (V1-10). This
   is what makes "accounts optional" a fact rather than a slogan: adopting an account is never a
   migration of the document.
3. **Invite keys are rows, not tokens.** A `invite_keys` row carries workspace, role, expiry, a maximum
   use count, a used count and a `revokedAt`. Redeeming one inserts a `workspace_members` row and
   nothing else — an invitation never touches the document, and revocation is a single update. Signed
   tokens are rejected below.
4. **The owner key survives as the offline key, not as the identity.** An owner link remains a valid
   way to open a workspace you own (and the only one when the control plane is unreachable); what
   changes is that the account is the *recoverable* path, so the recovery-words runbook becomes a
   fallback rather than the primary story. `File → Recovery key…` stays.
5. **Entitlement is checked on the server, from the licence.** The relay already verifies the Ed25519
   licence and records claims per licence id; the new work is that a session's **seat** (a named member
   of an owned workspace) is checked against the licence's workspace and seat allowance at the point of
   connection, so a lapsed licence loses *sync* and never loses local data (V1-17). A client claim is
   never trusted.
6. **Billing gets a front door.** One route creates a Stripe Checkout session in the configured mode,
   reading `STRIPE_SECRET_KEY` and `STRIPE_PRICE_TIERS`; a Portal route opens subscription management;
   the existing webhook stays the only thing that mints a licence. **Test mode is the default for every
   non-production deployment**, and a surface that cannot charge says so rather than pretending.
7. **Real money still needs the durable store.** Taking payment requires the DynamoDB (or equivalent)
   store with conditional writes — it exists behind `SUITE_BILLING_STORE`. Test mode may not:
   dual-minting a test event costs nothing, dual-minting a real one costs a customer their trust.
8. **Beta takes the account branch, and retires the other one.** beta.md's "Beta does not claim both"
   is honoured by choosing: B6 becomes the account artifact (claim flow, device list, revoke, recovery),
   and the operator-recovery procedure moves to "what we do when the control plane is down" — a runbook
   about availability, not about identity.
9. **Postgres arrives with this, for the control plane only.** Document BLOBs stay opaque in their own
   store; the licence table, members, invites, sessions and audit rows live beside Better Auth's tables.
   No document data enters Postgres, so the self-host parity promise (one image family, feature-flagged
   account service) survives.

## Consequences

- **The worst support scenario closes.** "I lost my browser and whoever opens the link first owns my
  workspace" stops being possible for owned workspaces: the owner is a row, and devices are listed and
  revocable.
- **Invitations become ordinary rows**, so the tester-onboarding story is "send them a key with an
  expiry" rather than "send them the owner link and hope".
- **The owner key stops being the only secret.** security-model.md's P2-1 (an owner key readable by any
  same-origin script) is mitigated rather than solved: an owned workspace's day-to-day session is an
  HttpOnly cookie, and the owner key is used for offline and recovery paths.
- **Anonymous stays first-class.** A person can still make a workspace with no account, share it, and
  never see a login. The account is an *ownership layer*, matching beta.md's framing.
- **Two identity paths must not disagree.** A request may hold a session, an owner key, or a share
  token; the resolver is one function with a documented precedence (session > owner key > share), and
  that precedence is tested — this is the highest-risk part of the whole phase.
- **A billing surface that is off must look off.** The alpha closes A5 by being *explicitly closed*; the
  new UI keeps that property: with `SUITE_BILLING_ENABLED` off there is no button that implies payment.
- **Costs and operations grow**: one more process, one more database, one more secret set (Stripe keys,
  SES identity, licence signing key). That is the price of the three costs above and it is accepted.

## Amendment — 2026-10-25: Better Auth Organizations *is* the workspace

The first draft invented a `workspaces` table and a `workspace_members` table beside Better Auth. That
was a mistake: Better Auth's **organization plugin** already models exactly what a workspace needs —
an organization with a `name`, a unique `slug`, a `logo`, `metadata`; **members** with roles;
**invitations** with an inviter, an expiry and a status; an **active organization** on the session; and
hooks before and after each of those operations. Re-implementing that would be two membership models
that can disagree, which is the one thing a permissions system must never be.

1. **One organization per workspace, and the document id survives.** Better Auth generates the
   organization's own id, but a workspace's identity is its *document* id and every share link, owner
   link and URL fragment already names it. So the workspace id lives in **`organization.slug`** — the
   plugin's one required, unique, user-chosen string — and `metadata.workspaceId` mirrors it where a
   slug's charset is too narrow. Claiming a workspace therefore sets a slug, and changes nothing else.
2. **Roles are asked for at the granularity Better Auth has.** The organization roles are
   `owner | admin | member`; our capability matrix has eight booleans. One function maps them
   (`capabilitiesForRole`), and it is the only place the mapping exists: **owner** is the licence
   holder and schema owner, **admin** edits content and layout and may manage links, **member** reads
   and edits content. Custom roles are Better Auth's `ac`/`roles` feature, deliberately unused in alpha
   — a permissions matrix with no UI to explain it is a support burden, not a feature.
3. **Teams are refused, on purpose.** The plugin offers teams *inside* an organization. Our sync unit
   is one `LoroDoc` per workspace, so access cannot be finer than the whole document: a "team" that
   could not be enforced at the relay would be a promise the architecture breaks on the first sync.
   Per-board access stays what it is — a share projection (ADR-0022), not a permission.
4. **Two kinds of invitation, because they answer different questions.** An **organization invitation**
   is email-bound, has an inviter, an expiry and a status, and is the normal way to add a member. An
   **`invite_key`** is a shareable row (role, expiry, max uses, revoked-at) for a tester you cannot
   email or do not want to — it is redeemed into the same `member` table, atomically, and it is the
   one invitation that survives being forwarded. Neither touches the document.
5. **Billing attaches to the organization, not to a person.** A subscription's
   `client_reference_id` is the organization id, and the licence's `workspaces` allowance reads as
   *how many organizations this customer may own* — which is how one agency hosts several clients, and
   how the self-hosted edition supports many organizations in one deployment without a second concept.
   A seat is a member of an owned organization; the check stays server-side (§5).
6. **Hooks carry our policy, never our data.** `beforeCreateOrganization`, `beforeAddMember` and
   `beforeAcceptInvitation` are where the licence and the invite rules are enforced. A hook that
   touches a document is a hook that can corrupt one, so none does.
7. **What this buys.** Hosted: each organization is a customer boundary — seats, licence, usage and
   support all key off one id. Self-hosted: the same model, with many organizations in one deployment
   and the account service feature-flagged (beta.md's editions promise survives unchanged). And the
   browser gets a workspace switcher for free: "the organizations I belong to" is a list Better Auth
   already returns.

## Rejected alternatives

- **Invite keys as signed tokens.** A signed token cannot be revoked without a revocation list, and a
  revocation list is a row — so the row is the primitive and the signature is ceremony.
- **Accounts required for everyone.** It breaks the local-first promise and the "adopt it without an
  account" line beta.md makes its identity claim on; anonymous workspaces keep working.
- **Sessions as the only way to open a workspace.** The relay would need the control plane to be up for
  a document to open; the owner key is what makes an outage survivable.
- **Trusting a client's licence claim.** A tampered client would keep syncing; the seat check is
  server-side or it is decoration.
- **Charging while the store is in-process.** beta.md's A5 already refused this; nothing in this ADR
  relaxes it.
- **A second, lighter auth system just for invite links.** Two identity systems is how a workspace ends
  up with two owners who disagree.
