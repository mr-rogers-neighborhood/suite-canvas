# Security model

Two credentials open a room: a session JWT for an account and a share token for a link. The owner key
that used to be the third was deleted ([ADR-0076](../../internal/decisions/open/0076-the-owner-key-is-deleted.md)),
with no migration for keys already issued.

This page describes the current architecture. It is not a promise of end-to-end encryption.

## Capabilities

| Credential | Shape | Grants | Does not grant |
| --- | --- | --- | --- |
| Session JWT | `Authorization: Bearer <jwt>` on HTTP, the join payload on a socket | Read and write the workspace rooms the token's organization owns, create and revoke share links, upload and delete attachments, delete the workspace | A workspace another organization recorded, a projection room, an admin route |
| Workspace editor token | `?share=<token>` | Read and write on the workspace document and its presence | Managing links, deleting the workspace, any account route |
| Workspace viewer token | `?share=<token>` | Read-only access to the workspace document | Any write, link management |
| Board or card viewer link | `?share=<token>` | Read-only access to a live projection of that board or card | The workspace index or id; any write |
| Selection viewer link | `?share=<token>` | Read-only access to a live projection of the selected cards on one board, the geometry of the sections those cards occupy, and the titles of cards they reference, marked not shared | The unselected cards, the workspace index or id, the selected ids, any write |
| Board or card editor link | `?share=<token>` | Editing a draft in its own `share-<token>` room, then publishing that draft | Writing the workspace directly, managing links |
| Internal worker tokens | `SUITE_PROJECTION_TOKEN` (legacy `SUITE_INTERNAL_TOKEN`) and `SUITE_SOURCE_TOKEN` | Server-to-server access for the projection worker: projection rooms only, and a workspace room only while it has an active editor share | Anything user-facing; they must never reach a browser or a log |
| Workspace purge token | `SUITE_RELAY_PURGE_TOKEN`, presented by the control plane as a bearer token | Delete the workspace named in the path, with `{"confirm":"<id>"}` in the body. Nothing else | Every other workspace route, `/api/admin/*`, any read |

A share token is random and stored only as a SHA-256 hash. The relay resolves it per room as `read` or
`write`. A share token can never mint or revoke another link, and it is not a session: a management route
answers `401` for one. When a worker token is unset, each server start generates a random one, which only
matters if a worker reconnects.

The app reads explicit capability flags rather than one read-only switch: `canEditContent`, `canEditLayout`,
`canCreateContent`, `canCreateBoards`, `canManageBoards`, `canManageSchema`, `canManageTrash`,
`canPublish` and `canManageLinks`. A workspace editor token gets the live workspace surface, meaning
boards, types, tags and trash, with no share, export or account actions. A board draft can create cards,
sections and edges and edit what it publishes; a card draft edits only its card. Neither can create
boards, schema, trash or links.

## The session token

The control plane mints a session JWT through Better Auth's `jwt()` plugin and publishes the key set at
`GET <SUITE_AUTH_URL>/api/auth/jwks`. The relay verifies the token locally. It holds no identity table, no
Postgres credential, and makes no control-plane call per message.

The token is Ed25519, its issuer and audience are both `SUITE_AUTH_URL`, and every claim is read
server-side when it is minted:

| Claim | Source | What the relay does with it |
| --- | --- | --- |
| `sub` | the session's user | Audit context only; the relay never looks an account up |
| `org` | `session.activeOrganizationId` | Compared with the organization the relay recorded for the workspace |
| `role` | the `member` row | Sets the seat label and the app's capability flags |
| `tier` | the organization's subscription row | A token with no tier is refused |
| `limits` | the same row | Recorded per workspace, so a save that carries no token still meets the caps |

The lifetime is 300 seconds (`RELAY_TOKEN_TTL_SECONDS` in `services/auth/src/identity/relayToken.ts`).
That number is the revocation window and it is published on purpose: a seat removed, a role lowered or a
subscription cancelled takes effect at the next mint, so a revoked member keeps a working socket for at
most five minutes. The client asks `GET /api/auth/token` for a fresh token and presents it on the next
join; a live socket is not re-authenticated mid-session.

### What the relay checks, and what it refuses

`apps/collab-server/src/http/sessionToken.ts` verifies the signature, `iss`, `aud`, `exp` and `iat`, then
narrows the payload to the five claims above. Anything else in the token is ignored. A token that fails
any step is a refusal: the join closes, and nothing is retried as a share token or as a second
credential. `apps/collab-server/src/sync/seatGate.ts` then answers from the claims alone, with no database
read. It refuses a session whose `org` is empty and a token whose `tier` is empty, and it treats a share
visitor as a capability rather than a seat.

### The key set cache

The relay fetches the JWKS at most once per five minutes of use and reuses it in between, so a busy relay
does not call the control plane. Two events force a refetch: the cache ageing out, and a token naming a key
id the cache has never seen. The second is subject to a five-second cooldown, which is what keeps a forged
`kid` from turning every join into a control-plane request; the cost is that a newly rotated key refuses
joins for at most those five seconds. Clock tolerance is 30 seconds in each direction, because a relay
whose clock has drifted should not refuse a valid token. The tolerance is small on purpose: it adds to the
TTL, so a generous value would widen the revocation window by the same amount.

The relay fetches nothing at boot. A control plane that is down means no account can join; a control plane
that comes back is picked up by the next fetch, without restarting the relay.

## What a browser with no session can do

A workspace with no account is local-only. It opens, edits, exports and deletes from the browser with no
prompt and no credential, and it never reaches a relay. The socket answers `Authentication failed` because a
room credential is a session token, and a token names an organization.

This is a deliberate narrowing, not a gap left open. The owner key used to authorise a local room by being a
bearer secret nobody else had. Deleting it removed the only attribution such a connection had, and inventing
a second credential for it would have recreated the thing that was deleted. Sync also costs a seat, so it
needs an owner to charge.

Better Auth's anonymous sessions are gone for the same reason. A session that could be created without a
person is a session nobody can be charged for and nobody can be held to, and the browser never needed one:
the document is in IndexedDB, and the workspace id in the URL is the whole of its identity.

The local-first promise survives intact. Everything a reader can do alone still works with no account, and
the document is theirs to export. What changes is the second browser. A workspace becomes visible to another
machine at the moment it is claimed by a signed-in account, which is also the moment it can be paid for. The
claim is the first join: the relay records the organization on the `workspace_orgs` row and the ids do not
change, so a link shared point-to-point before sign-up still resolves afterwards.

A self-hosted instance that runs only the relay therefore has no sync either. It is the same rule seen from
the other side: the relay has no way to decide who may join, so it refuses everyone. A self-host that wants
collaboration runs the control plane beside it, which `compose.yaml` already does.

## Which organization owns a workspace

The control plane's `workspaces` row is the authority: `workspaces.id` is the document id, and
`workspaces.organization_id` is the tenant ([ADR-0065](../../internal/decisions/open/0065-accounts-own-workspaces.md)).
The relay holds no Postgres credential, so it keeps its own copy in the `workspace_orgs` table of the file
`SUITE_WORKSPACES_DB` names, and it writes that row when the first verified session opens the workspace.
The first claim wins. A later join from another organization is refused with
`403 This workspace belongs to a different organization.`, and the recorded row is untouched.

The relay's copy can be wrong in exactly one direction: a workspace nobody has opened on this relay is
claimable by the first account that names its id in a verified session. That is the same first-claim rule
the owner key had, made stronger by requiring a token the control plane signed. On a deployment where
workspace ids are shared widely, treat an unopened workspace as unclaimed until its owner opens it.

## Share links

Share links still work for a visitor with no account: resolving a link stays public, because the token is
the credential the recipient holds. The first open exchanges the token for a short-lived `HttpOnly`
session cookie, and later requests carry the session, which has a 15-minute TTL, is hashed at rest, and is
deleted when the share is revoked. A link never becomes a seat and is never asked for one; it is bounded by
its own expiry and revocation. Hosted links default to 30 days.

A published page has one address: `/s/<slug>?share=<token>`. The slug is derived once, when the link is
created, from the name of the card or board it publishes, or from the scope word when there is no name; it
is unique inside its workspace and never reused, revocation included, so a copied address never comes to
mean a different page. The slug is not a credential: it resolves nothing on its own, and the token, or the
session the token was exchanged for, remains the only thing that opens the projection. The address keeps
its slug for good, so a reader can reload the page, or come back to the address the author copied, with no
account; what they present is the session cookie, which slides while the page is used and dies with the
link.

A leaked share link is fixed by revoking that link. Revocation stops new joins, closes the open sockets
that hold it, and removes the projected draft. It does not change the workspace, and it does not close the
account that is editing the workspace. A reader who returns to a revoked address is told the page was
unpublished; the shell never renders an empty projection in its place.

What publishing costs in exposure: the card, and every link inside it, becomes readable by anyone holding
the address, and the author is told that in the share dialog before the link exists.

## What the relay can see

Documents are plaintext. The document store holds the full Loro snapshot of every workspace, and the
operator can read all of it. An SVG or HTML upload is refused because a served attachment must never be
executable content.

Share tokens are stored as SHA-256 hashes, so a stolen database does not directly hand out working
credentials. Session tokens are not stored at all: the relay holds a public key and verifies a signature,
so a stolen relay database yields nothing that opens a room. The licence rows beside a workspace are
bookkeeping, not credentials.

A live socket keeps its credential in memory. The revoke path has to decide which open sockets belong to a
share it just invalidated, so the patched sync server keeps each socket's credential per joined room for as
long as the socket is connected, and clears it on leave and on disconnect
(`patches/loro-websocket@0.6.2.patch`). That does not expose a session to the operator; it does mean "not
stored" should not be read as "never in memory".

Attribution stops at the link. An account's join is attributable to the `sub` in its token for as long as
the relay logs it, and presence (names, pointers, carets) is ephemeral and never written to the document, so
every editor using a link shares that link's identity. Metadata still exists: workspace ids, board and card
ids in share rows, creation, last-use and revocation timestamps, the organization id recorded per
workspace, and the IP addresses seen by the server or its proxy. The last-used timestamp is coarse, at most
one write a minute, and says a link was opened, not by whom.

Backups are unencrypted. All six SQLite stores and `.suite` exports contain the same plaintext documents,
every uploaded image, and the licence and quota bookkeeping. Suite does not encrypt them.

## Sharing risks

Anyone who receives a link can forward, copy or screenshot the workspace. Revoking a link cannot take back
what was already read.

A share token in a URL can leak through access logs, analytics, screenshots or browser sync. Serve the app
with a restrictive `Referrer-Policy` and do not log query strings.

A leaked session token is a working credential for up to five minutes, and it is as powerful as the person
it was issued to: it syncs, it mints links, and it deletes the workspace. It is not bound to a device. The
fixes are the TTL above, TLS everywhere, a restrictive CSP so XSS cannot read local storage or a token in
memory, and server-side session revocation in the control plane, which stops the next mint.

A link image is fetched from a third party by every reader. An `image` node stores a URL, so the viewer's
browser contacts that host, which learns the viewer's IP address and when the card was opened. Each link
image renders with `referrerpolicy="no-referrer"`, `loading="lazy"` and `decoding="async"`, so the
workspace URL and share token are not sent along, and the URL itself is document content, so a share
reader can see it. The CSP allows `https:` in `img-src` for this reason; an `attachment` keeps readers off
third-party hosts.

## Operator tokens

`/metrics` and `/api/admin/*` are gated by operator tokens, and both routes answer `404` while none is
configured. A token carries one or both scopes:

| Variable | Scopes | Can |
| --- | --- | --- |
| `SUITE_ADMIN_TOKEN` | `read`, `mutate` | Everything below |
| `SUITE_ADMIN_READ_TOKEN` | `read` | `GET /metrics`, the status, room and share inventories, the workspace list and export |

`read` cannot mutate. A mutation presented with a read token answers `403` and is recorded, because an
attempt to escalate is a fact an operator wants in the log. The two variables must hold different values;
the same secret in both does not widen the read token.

Every mutating admin request writes one audit row to the relay's log, tagged `admin.mutation`:

```json
{"msg":"admin.mutation","actor":"admin","action":"delete-workspace","target":"ws-1","result":"deleted","path":"/api/admin/workspaces/ws-1"}
```

`actor` is `admin` or `admin-read`, never the token. `result` is `ok`-family (`created`, `deleted`,
`revoked`, `updated`, `swept`), `refused`, `refused-scope` or `failed`. The relay writes no other audit
store, so ship these lines somewhere that keeps them: a log line that scrolls away is not an audit trail.

## Recovery and device hygiene

There is no owner key to lose. Recovering access is the account's job in the control plane: magic link,
passkey or a provider login. An account with no organization can sign in and read its own settings, and it
cannot sync a workspace, because a session with no `org` has no tenant to be licensed under.

Forget this browser clears the cached document, the recent-workspace entry and any local editor state on
that browser only. It does not end the session; sign out in the app for that.

An exported `.suite` file opens without an account. An exported `.suitekey` file from an earlier release is
not read any more, and no support path restores it.

Operator-side, `admin delete` removes a workspace's documents, projected share rooms, share rows, draft
baselines and recorded organization. `admin reset-owner` no longer exists: ownership is a row in the
control plane, so the operator action is the control plane's own delete or transfer, not a file edit on the
relay.

## Deployment expectations

TLS is required. Serve the app, the relay and the control plane over HTTPS and WSS, do not expose the
plaintext HTTP ports, and prefer one same-origin deployment. `SUITE_ALLOWED_ORIGINS` is the browser
allowlist: unset answers a loopback origin only, a list answers exactly those origins, and `*` answers any
origin, which is a decision an operator makes rather than a default.

Encrypt the host disk and the backups. SQLite has no encryption at rest in Suite, so use an encrypted
volume for the data directory and encrypt off-site backups.

Back up all six stores together. `documents`, `shares`, `workspaces`, `settings`, `licences` and
`attachments` live in separate files under `/data` in `compose.yaml`. Copy them while the server is
stopped, or use `deploy/backup.sh`, and include any `-wal` and `-shm` sidecars. A mixed backup can pair
documents with the wrong share rows, and one that omits `attachments` leaves every image as a permanent
placeholder, because the document stores only an id. Restore into a fresh volume with
`deploy/restore.sh`, and do not put these files on a network filesystem.

Run a single instance, because rooms, presence, projection state, the key-set cache and rate-limit counters
live in one Node process and SQLite is local to it. There is no shared lock and no multi-replica mode;
restarting drops live sockets and not documents.

Expect rate limits and add proxy limits. The server applies in-process fixed-window limits per client
address to workspace deletion, share creation, token resolution and publish, and answers `429` with
`Retry-After`. Override with `SUITE_ROTATE_RATE_LIMIT`, `SUITE_SHARE_CREATE_RATE_LIMIT`,
`SUITE_SHARE_RESOLVE_RATE_LIMIT` or `SUITE_PUBLISH_RATE_LIMIT`, and set `SUITE_TRUST_PROXY=1` behind a
trusted proxy. These limits stop casual abuse, not a determined flood, so put request-size and connection
limits in the reverse proxy too.

## Operator commands

There is no user-facing delete everywhere action. The destructive operation is a SQLite command run on the
host, and without `--force` it prints the stop-the-server instruction and exits non-zero without opening a
database.

```sh
# Stop the collab server first. Deletes the workspace document, share rows,
# baselines, projected share documents and the recorded organization.
pnpm --filter @suite/collab-server admin delete <workspaceId> --force
```

The command reads `SUITE_DB`, `SUITE_SHARES_DB` and `SUITE_WORKSPACES_DB`, which default to
`suite.documents.sqlite`, `suite.shares.sqlite` and `suite.workspaces.sqlite` relative to the package
directory when run through `pnpm --filter`. Deletion is immediate and cannot be undone, so take a backup
first.

## Threat model

The rest of this page describes what the system does. This section says what it is defending against, so
a mitigation can be read as an answer to a named adversary rather than as a feature list.

### Assets, in the order a leak hurts

| Asset | Where it lives now | Blast radius if it is read |
| --- | --- | --- |
| Document content | plaintext Loro snapshots in `documents.sqlite`, `.suite` exports, backups | Everything the workspace ever held. There is no encryption to break, only access to control. |
| Attachment bytes | `attachments.sqlite` on the relay | The same, for images: pasted screenshots, scans, photos. |
| Account identity | Postgres: users, sessions, organizations, members, invitations | Who works with whom, and every address an account signed up with. |
| Share tokens | SHA-256 hashes in `shares.sqlite` | A working link, which is a working credential, until it is revoked or expires. |
| Operator tokens | the process environment (`SUITE_ADMIN_TOKEN`, `SUITE_ADMIN_READ_TOKEN`) | Every workspace's metadata, every link, and the ability to delete. |
| Licence private key | never on the relay; the control plane signs with it | The ability to mint entitlements for any tier. |
| Licence claims | `licences.sqlite` per workspace, `licence` rows in Postgres | Quota bookkeeping, not a credential. |

### Adversaries and the path each one takes

| Adversary | Path | What stops it today |
| --- | --- | --- |
| Anonymous internet | probing `/api/*`, `/ws`, `/metrics`, `/api/admin/*` | Share resolution is the only unauthenticated read and it needs a token; `/metrics` and `/api/admin/*` answer `404` while no operator token is set; CORS names its origins; every route has a per-address rate limit. |
| A share-link recipient | the link itself | The link is written as a hash, expires (30 days by default), and can be revoked; revocation closes the sockets holding it and drops the projected draft. It cannot be turned into an account credential or used to mint another link. |
| A revoked member | a session JWT already held | The 5-minute TTL is the revocation window. A live socket is not re-authenticated mid-session, so a removed member keeps a working socket for at most that long. |
| Another organization | naming someone else's workspace id in a verified session | First claim wins: the relay records `workspace_orgs` on the first verified join and refuses a later one from a different `org` with `403`. The relay never consults Postgres per message. |
| A hostile member of the same organization | a valid session for the same tenant | Nothing above the organization boundary. Members of one tenant are trusted with each other's workspaces by design; the `role` claim only labels the seat and sets capability flags in the app, and the relay does not enforce a per-role split inside a tenant. |
| An XSS payload in a shared document | the page's own origin | The CSP in `deploy/Caddyfile` (`script-src 'self'`, no `unsafe-inline` on the app hosts) plus React's escaping. A successful one would read whatever the tab can reach: the in-memory session token and, on the operator panel, the token in `sessionStorage`. |
| A network attacker | the wire | TLS is required; `Strict-Transport-Security` is set on every site; the app never mixes an `https` page with a `ws://` socket. |
| Someone holding a backup | the bucket or `/srv/backups` | Nothing in Suite: snapshots are plaintext. Encryption at rest is the host disk and the bucket's server-side encryption. |
| A compromised dependency | any package in the tree | Nothing specific to Suite beyond a frozen lockfile, a pinned pnpm version and a supply-chain policy check on install. Treat `better-auth`, `loro-*` and the Stripe SDK as trusted code. |
| The operator | `docker exec`, the database files, `/metrics` | Nothing. An operator can read every document and delete any of them. This is a stated capability, not a vulnerability; the only control is the audit line every mutating admin request writes. |

### What this model does not claim

There is no end-to-end encryption, so the relay is inside the trust boundary for content. There is no
at-rest encryption of documents, so disk access equals content access. A share link's reader cannot be
attributed beyond "the link was opened", and presence is discarded rather than recorded. Nothing here is
a promise of forward secrecy or of surviving a compromised relay host.

## Content Security Policy and violation reporting

Every site sends an enforcing `Content-Security-Policy`. `Content-Security-Policy-Report-Only` appears
nowhere, because a report-only policy protects nobody and a site that downgraded to one without saying so
would look safe and be open.

The two sites that proxy `/api/*` to the relay also send `report-uri /api/report/csp` and
`report-to suite-csp`, plus the `Report-To` and `Reporting-Endpoints` headers that name the same path.
Both directive names are present on purpose: `report-to` is the Reporting API, `report-uri` is what the
other browsers still implement.

`apps/collab-server/src/http/report.ts` is the collector:

- It accepts `application/csp-report`, `application/reports+json` and a plain JSON body, and answers
  `204` with no body whatever happens, because a malformed report is not an error a browser can act on.
- The body is capped at 16 KiB and reports are limited to 120 per address per minute. Past either bound
  the request is dropped, still with `204`, so a page that reports in a loop cannot turn into a disk
  filler or a retry storm.
- One `csp.violation` log line per accepted report carries `documentUri`, `blockedUri`, the directive,
  `disposition`, `sourceFile` and the line number. `documentUri` and `sourceFile` are redacted with the
  same rule as the request log, because the page that triggered a violation can be a share link whose URL
  carries a token in the query.
- Nothing is stored and nothing is re-served. The collector is a log writer, not a database.

## Your data: export and deletion

Two things are true at once, and the difference matters to anyone filing an erasure request.

### Workspaces

A workspace export: the app writes a `.suite` file from the live document, and an operator can export
the same workspace through `GET /api/admin/workspaces/:id/export`. The file opens without an account and
contains the document; it does not contain account rows or the relay's share records.

A workspace delete, by the account that owns it (`DELETE /api/workspaces/:id`), by the control plane while
it erases an account (the same route with `SUITE_RELAY_PURGE_TOKEN`), or by an operator
(`admin delete`). It removes, in one pass: the workspace document and every projected share room, the
share rows and their draft baselines, the recorded organization row, the licence record when the relay
is hosted, and every attachment row and byte of that workspace. The response reports each count, so a
delete that removed less than expected is visible instead of assumed.

The local half: `purgeWorkspaceLocally` clears this browser's cached document, recents entry, cached
credential and licence token. Another device keeps its copy until it opens the workspace again and
finds the relay empty.

### The account

An account can take its data and close itself. Both actions are control-plane routes in
`services/auth/src/http/routes.ts` and need the session cookie only.

`GET /api/account/export` answers one download, `suite-account-<userId>-<date>.json`, with
`content-type: application/json` and `content-disposition: attachment`. The shape is versioned with
`format` (`suite-account`) and `version` (1):

| Field | Holds |
| --- | --- |
| `account` | the `user` row: id, address, name, address verification, second-factor state, and the created and admitted times |
| `organizations[]` | every organization the account belongs to, its name and slug, and the account's own `membership` (role and joined time) |
| `organizations[].workspaces[]` | the workspace id, name and timestamps, a `document` reference, and the workspace's `shares` |
| `shares[]` | share id, scope, role, created, expiry and revocation times |
| `notes` | what the file does not contain, in the file itself |

Document bytes are referenced, never copied. `document.exportedHere` is `false` and
`document.exportPath` names the operator export route, because a `.suite` file already exports one
workspace and this service holds no document store. `notes.documents` says the same thing to a reader
who never saw this page.

The file carries nothing that belongs to another person. A member row contributes the account's own
role, never somebody else's id, role or address, and a share contributes no token and no hash: a hash is
a working credential, and this file leaves the deployment. `notes.otherPeople` states that.

Share metadata comes from the relay when the deployment injects a `WorkspaceDataStore` into the account
routes. Without one, each workspace carries `sharesUnavailableReason` instead of an empty list, so "no
links" and "could not read the links" do not look the same.

`DELETE /api/account` requires the account's own id in the body as `{"confirm":"<userId>"}`, the shape the
relay's workspace delete already uses, so a stale tab cannot erase an account it never named.

The erase runs in this order, and the order is the design:

1. Read the account once. An organization the account is the only member of is deleted whole. An
   organization another person still holds a seat in is kept, and only the account's own member row is
   removed from it.
2. Delete the relay-owned data for the workspaces of the deleted organizations: the document and its
   projection rooms, the share rows and their baselines, the attachment rows and their bytes. Every one
   of those deletes is idempotent.
3. Delete every control-plane row in one Postgres transaction, with the `user` row last.

A failure before step 3 leaves the account whole and able to sign in, so the same request can be sent
again and the idempotent relay deletes finish the job. A failure inside step 3 rolls the transaction
back, so the account is equally intact. The `user` row goes last because it is the row that
authenticates the retry. The account is never usable and half-deleted: its rows leave in one
transaction, and the part that cannot join that transaction runs first and is reported.

The answer is a per-store report, never a bare success. `200` means the account row is gone and `500`
means it is not; in both cases `deleted`, `complete`, `organizations`, `workspaces`, `stores` and
`retry` describe what happened. Each entry in `stores` names one store (`organizations`, `members`,
`workspaces`, `invitations`, `invites`, `licences`, `subscriptions`, `sessions`, `accounts`,
`verifications`, `passkeys`, `twoFactor`, `users`, `documents`, `shares`, `attachments`) with a status
(`removed`, `not-removed`, `not-attempted` or `not-configured`), the number it removed, and a reason and
follow-up command when it removed less.

The three relay stores report `removed` with the count the relay answered when the deployment sets
`SUITE_RELAY_URL` and `SUITE_RELAY_PURGE_TOKEN`. The control plane then sends the same delete the account
sends, on its own credential, and the report carries what came back. Without that pair they report
`not-configured`: the account is still deleted, and the report names the route that finishes each
workspace, which is `DELETE /api/workspaces/<id>` with the owning account's session, or
`pnpm --filter @suite/collab-server admin delete <id> --force`.

The purge credential is a third token rather than `SUITE_ADMIN_TOKEN`. The account service is the process
with a public sign-in surface, and the operator token would let a fault there reach every workspace's
limits, rooms and links. This one deletes the workspace it is handed and opens nothing else, and it is set
on each side independently, so rotating it costs one restart of each process.

**Backups age out; they do not vanish.** A delete is immediate on the live stores and permanent for the
relay, but the snapshot that contains the deleted rows is kept until its retention window passes:
`deploy/backup.sh` writes a daily copy and a weekly copy on Sundays, and the bucket lifecycle rule expires
`daily/` after 7 days and `weekly/` after 35 days. The local `/srv/backups` directory is pruned by the
`find … -mtime +14` cron entry in [deploy.md](../how-to/deploy.md). So a deleted workspace or account can
remain recoverable from backup for up to 35 days, and from a Postgres dump on the same schedule for the
identity rows. That is the honest answer to "when is it really gone": after the window, not on the click.
