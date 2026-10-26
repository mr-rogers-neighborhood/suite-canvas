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
any step is a refusal: the join closes, and nothing is retried as a share token or as an anonymous
connection. `apps/collab-server/src/sync/seatGate.ts` then answers from the claims alone, with no database
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

A leaked share link is fixed by revoking that link. Revocation stops new joins, closes the open sockets
that hold it, and removes the projected draft. It does not change the workspace, and it does not close the
account that is editing the workspace.

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
