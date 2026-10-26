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

1. **An organization owns workspaces, and a link shares one.** Better Auth on a control plane
   (passkeys, magic link, Google — V1-9) issues a session cookie for the app origin. An organization is
   the **tenant**: it holds the members, the roles, the seats and the subscription, and it owns *many*
   workspaces. A workspace is one document. An **anonymous workspace** belongs to no organization and
   keeps working exactly as it does today; a workspace inside an organization is **owned**, and only an
   owned one can be billed, have members, or be listed on another device.
2. **Claiming keeps the identity of the work.** An anonymous workspace can be claimed by an
   organization without changing its id, its placements, or any share link already handed out (V1-10).
   This is what makes "accounts optional" a fact rather than a slogan: adopting an account moves an
   *organization id* onto a workspace row and never touches the document.
3. **Invite keys are rows, not tokens.** An `invite_keys` row carries organization, role, expiry, a
   maximum use count, a used count and a `revokedAt`. Redeeming one inserts an organization `member`
   row and nothing else — an invitation never touches a document, and revocation is a single update.
   Signed tokens are rejected below.
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

## Amendment — 2026-10-25: Better Auth Organizations is the tenant, workspaces are its documents

The first draft invented a `workspaces` table and a `workspace_members` table beside Better Auth. That
was a mistake: Better Auth's **organization plugin** already models the tenant — a name, a unique
`slug`, a `logo`, `metadata`, **members** with roles, **invitations** with an inviter, an expiry and a
status, an **active organization** on the session, and hooks around each operation.

The second draft then over-corrected, making one organization *be* one workspace. The author's
correction is the right shape and it is more useful than either:

**An organization is the tenant and owns many workspaces. A workspace is one document.**

1. **The two levels, and what each is for.** The organization holds people, roles, seats and the
   subscription — everything that is *about the customer*. A workspace holds one `LoroDoc` — everything
   that is *about the work*. A person who joins an agency joins one organization and sees its
   workspaces; a person who is a solo user has an organization of one workspace and never notices it.
2. **Workspaces are rows in the control plane**, not a Better Auth concept:
   `workspaces (id primary key = the document id, organization_id → organization.id, name,
   created_at, archived_at)`. The primary key *is* the document id, so a workspace row can never rename
   the thing it points at, and **claiming** is one `UPDATE ... SET organization_id = $1` — no id, URL or
   share link changes (V1-10).
3. **`organization.slug` is the tenant's slug**, not a workspace id: it is what a hosted deployment can
   put in a URL or an invitation, and what a self-hosted operator can name. Workspace ids stay opaque.
4. **Roles are organization-wide, and that is the honest granularity.** Better Auth's `owner | admin |
   member` maps through one `capabilitiesForRole` function to our eight capability booleans: **owner**
   is the licence holder and schema owner, **admin** edits content and layout and manages links,
   **member** reads and edits content. A role applies to every workspace in the organization; a
   per-workspace override is a row we may add later (§6), and is deliberately not in alpha — a
   permissions matrix with no UI to explain it is a support burden.
5. **Teams become possible, and stay deferred.** Now that an organization owns many workspaces, a team
   *can* be enforced: it would be a set of workspace-access grants, and the relay authenticates one
   document per connection, so it can check "does this team grant this workspace?" without splitting a
   document. That is the only finer granularity our sync model supports — **access can be per
   workspace, never per board or per card**. Teams ship after alpha, in their own ADR, as exactly that:
   grants over a set of workspaces.
6. **Two kinds of invitation, because they answer different questions.** An **organization invitation**
   is email-bound, has an inviter, an expiry and a status, and is the normal way to add a member. An
   **`invite_key`** is a shareable row (role, expiry, max uses, revoked-at) for a tester you cannot
   email or do not want to — it redeems into the same `member` table, atomically, and it is the one
   invitation that survives being forwarded. Neither touches a document.
7. **Billing attaches to the organization.** A subscription's `client_reference_id` is the organization
   id; the licence's `workspaces` field is the ceiling on how many workspaces that organization may
   hold, and its `documentBytes`/`attachmentBytes` are per workspace as they already are. Seats are
   organization members. This is how an agency hosts several clients' workspaces, how a solo user has
   one, and how a self-hosted deployment runs many organizations without a second concept.
8. **Hooks carry our policy, never our data.** `beforeCreateOrganization`, `beforeAddMember`,
   `beforeAcceptInvitation` and a `beforeCreateWorkspace` check are where the licence and the invite
   rules live. A hook that touches a document is a hook that can corrupt one, so none does.
9. **What this buys.** Hosted: an organization is a customer boundary — seats, licence, usage and
   support key off one id, and one customer can hold many workspaces without many subscriptions.
   Self-hosted: the same model with the account service feature-flagged (beta.md's editions promise
   survives). And the browser gets a two-level switcher: the organizations I belong to, and — inside
   one — the workspaces it owns, which is the launcher this product was going to need anyway.

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

## Amendment — 2026-10-25: identity, invitations and seats move to three successors

This ADR settled *who owns a workspace*. Three of its mechanisms have since been superseded by
decisions that take the same model further, and leaving them here would make the record lie.

1. **Item 3 (`invite_keys` are rows, our redemption SQL) is superseded by
   [ADR-0067](./0067-the-account-is-the-identity.md) §10.** Shareable, capped and revocable invites are
   still the requirement; they are now `better-enrollment`'s public invites, and our `invite_keys`
   table, `redeem_invite_key()` function and bespoke redemption route are deleted. The invariant that
   made the row design correct — one guarded atomic write, so two racers on a one-seat invite produce
   one winner — is preserved by the plugin, and the seat hook stays ours.
2. **Item 4 (the owner key survives as the offline key, `File → Recovery key…` stays) is superseded by
   [ADR-0067](./0067-the-account-is-the-identity.md) §1–§5.** The owner key still survives as the
   transport credential and a valid offline way in, but it is no longer presented as something a person
   keeps: the passphrase path is deleted, recovery words are retired to a single advanced *Owner file*,
   and the account is the recovery story.
3. **Item 5 (entitlement is checked from the licence) stands, and gains a source.** The relay is
   unchanged — it verifies an Ed25519 token offline. What changes is where that token's numbers come
   from: [ADR-0069](./0069-billing-runs-on-the-stripe-plugin.md) makes plan `limits` the single
   definition, with the issuer reading subscription state instead of a hand-rolled webhook.

The org-owns-many-workspaces model itself is untouched: `workspaces.id` is still the document id, and
claiming is still one `UPDATE` that changes no id and no share link.
