# Security model

Anonymous workspaces are what ships: no sign-up, no email, no password reset, and no user identity on the
relay. Every credential is a bearer capability, so whoever holds the link has what the link grants and
the server cannot tell two holders apart.

An account layer exists in `services/auth` and is not wired into a running relay. What it adds, and what
it will not change, is below.

This page describes the current architecture. It is not a promise of end-to-end encryption.

## Capabilities

| Credential | Shape | Grants | Does not grant |
| --- | --- | --- | --- |
| Owner link | `?workspace=<id>#owner=<key>` | Full read and write, creating and revoking share links, rotating the owner key | Recovery of a lost key; the relay stores only its hash |
| Workspace editor token | `?share=<token>` | Read and write on the workspace document and its presence | Managing links, rotating the owner key, claiming the workspace |
| Workspace viewer token | `?share=<token>` | Read-only access to the workspace document | Any write, link management, the owner key |
| Board or card viewer link | `?share=<token>` | Read-only access to a live projection of that board or card | The workspace index or id; any write |
| Selection viewer link | `?share=<token>` | Read-only access to a live projection of the selected cards on one board, the geometry of the sections those cards occupy, and the titles of cards they reference, marked not shared | The unselected cards, the workspace index or id, the selected ids, any write |
| Board or card editor link | `?share=<token>` | Editing a draft in its own `share-<token>` room, then publishing that draft | Writing the workspace directly, managing links |
| Internal worker tokens | `SUITE_PROJECTION_TOKEN` (legacy `SUITE_INTERNAL_TOKEN`) and `SUITE_SOURCE_TOKEN` | Server-to-server access for the projection worker: projection rooms only, and a workspace room only while it has an active editor share | Anything user-facing; they must never reach a browser or a log |

The owner key is 32 random bytes generated in the browser and kept in local storage plus the URL fragment.
The relay stores only a SHA-256 hash. Share tokens are random too, stored only as hashes, and resolved per
room as `read` or `write`. A share token can never mint or revoke another link; that needs the owner key.
When a worker token is unset, each server start generates a random one, which only matters if a worker
reconnects.

Workspace editor tokens are the way to invite someone to edit. Do not send the owner link as an editor
invitation, because it also carries link management and owner-key rotation.

The app reads explicit capability flags rather than one read-only switch: `canEditContent`, `canEditLayout`,
`canCreateContent`, `canCreateBoards`, `canManageBoards`, `canManageSchema`, `canManageTrash`,
`canPublish` and `canManageLinks`. A workspace editor token gets the live workspace surface, meaning
boards, types, tags and trash, with no share, export or recovery actions. A board draft can create cards,
sections and edges and edit what it publishes; a card draft edits only its card. Neither can create
boards, schema, trash or links.

## Accounts

Everything above stays true for every workspace with no organization behind it. Accounts add an ownership
layer and do not replace the capability model.

An organization is the tenant and owns many workspaces. A `member` row with a role (`owner`, `admin`,
`member`) replaces "whoever holds the link" for the people inside it. `capabilitiesForRole` in
`services/auth` maps that role to the same nine flags a share session gets, and the UI reads the flags.
Claiming an anonymous workspace sets its organization and changes nothing else: the document id, its URL
and every share link already handed out keep working.

The owner key stays the offline key, the only way to open a workspace when the control plane is
unreachable. Share links still grant exactly what their role says. Anonymous workspaces stay first-class,
ungated by any licence and needing no login.

The account became the identity and the key became plumbing. The passphrase path is gone, because it
derived a key from recovery words and silently rotated the owner key, invalidating every link and
`.suitekey` file a person had saved; the encoder survives as one advanced Owner file export beside
`.suitekey`, for self-hosters who keep no account. A forgotten credential is the account's job: magic
link, passkey or a provider login. Signing in claims rather than migrates, and the claim is one `UPDATE`
of `organization_id`, which is what makes accounts safe to adopt late.

Registration is open and admission is reviewed. A new account starts with `admittedAt: null`, and one
server-side gate refuses creating an organization, claiming a workspace and opening a sync connection
until an operator admits it. Local editing, import and export are never gated, because local-first is
not a privilege; this is a licensing control and it never decides who may read a document. Emails are
normalized with a unique index and 55k disposable domains are blocked, because per-seat billing turns a
duplicate account into a duplicate seat, and an invisible Turnstile challenge sits in front of the queue.

### What is wired today

`services/auth` is built and tested: Better Auth with the organization plugin, magic link and passkeys,
the plugin hooks for the tenant ceiling and licence seats, invitation redemption, and the memory and
Postgres repositories. Its HTTP entry exists and no process mounts it.

The relay does not accept sessions. A websocket join carries an owner key or a share token, so
`apps/collab-server/src/sync/seatGate.ts` refuses an account principal with `account-check-unavailable`
instead of guessing a seat count, and no running process opens a Postgres pool. The SQL that adapter must
satisfy is in `services/auth/sql/`.

One resolver, one precedence: session, then owner key, then share token. The session wins only when it
names the organization that owns the workspace and the account still has a member row there. Two
consequences matter when reading a bug report. A signed-in person opening someone else's share link is a
share holder, because their session names a different tenant. Someone removed from an organization who
still holds an owner link or a share link keeps that access, so removal is not revocation: rotate the
owner key and revoke the links.

The owner key is the only secret that protects a workspace, and it lives where XSS can read it. Sessions
do not change that, because a stolen cookie is a stolen session. The fixes are CSP, accounts, and
eventually device-bound sessions.

The control-plane database holds accounts, sessions, passkeys, organizations, members, invitations and
invitation hashes, plus password hashes for invited accounts. No document bytes, ever. An invitation
token is a SHA-256 hash at rest, single-purpose (it grants an organization role and never ownership),
expiring and revocable; redeeming it writes one member row.

A password exists only where an invitation created it. Self-serve password sign-up is closed, so the one
path that sets a password is redeeming a private invitation. Passkeys, magic links and Google sign-in
stay open. Because a password can be guessed as well as stolen, `/sign-in/email` is the one route with a
named rate-limit rule, and its limiter storage is per instance, so a multi-instance deployment needs a
shared store.

## What the relay can see

Documents are plaintext. The document store holds the full Loro snapshot of every workspace, and the
operator can read all of it. An SVG or HTML upload is refused because a served attachment must never be
executable content.

Credentials are hashed. Owner keys and share tokens are stored as SHA-256 hashes, so a stolen database
does not directly hand out working credentials.

A live socket keeps its credential in memory. The revoke path has to decide which open sockets belong to
a share or owner key it just invalidated, so the patched sync server keeps each socket's credential per
joined room for as long as the socket is connected, and clears it on leave and on disconnect
(`patches/loro-websocket@0.6.2.patch`). This is retention, not new exposure: the same process holds every
document in plaintext, so anyone who can read its memory already has the content. It does mean "hashed at
rest" should not be read as "never in memory".

Links remain the weak point. An owner key travels in the URL fragment and in the `Authorization` header
for owner API calls. A share token is exchanged on first open for a short-lived `HttpOnly` session cookie,
and the browser then replaces the URL, so the token leaves the address bar and forward history; later
requests carry the session id, which has a 15-minute TTL, is hashed at rest, and is deleted when the share
is revoked. Browser history, clipboard managers, chat backups and proxy logs can still capture the link
when it is shared, and a session id captured in transit is a credential for up to its TTL.

Sessions are scoped and disposable: a share session authenticates exactly one share's room, cannot join
another room, and is deleted with the share on revoke or expiry.

Attribution stops at the link. The relay cannot say who created or edited a card, because presence
(names, pointers, carets) is ephemeral and never written to the document, so every editor using a link
shares that link's identity. Metadata still exists: workspace ids, board and card ids in share rows,
creation, last-use and revocation timestamps, and the IP addresses seen by the server or its proxy. The
last-used timestamp is coarse, at most one write a minute, and says a link was opened, not by whom.

Backups are unencrypted. All six SQLite stores and `.suite` exports contain the same plaintext documents,
every uploaded image, and the licence and quota bookkeeping. Suite does not encrypt them.

## Sharing risks

Anyone who receives a link can forward, copy or screenshot the workspace. Revoking a link cannot take back
what was already read.

A share token in a URL can leak through access logs, analytics, screenshots or browser sync. Serve the app
with a restrictive `Referrer-Policy` and do not log query strings.

A leaked owner link is full ownership. Revoke the affected share links and rotate the owner key from File
then Recovery key. Rotation invalidates the old owner link and old `.suitekey` files, and revokes every
share link by default; uncheck that only when collaborators should keep their links.

A leaked share link is fixed by revoking that link. Revocation stops new joins, closes open sockets and
removes the projected draft, and does not change the workspace. Links can expire after 7 or 30 days, or
never.

A link image is fetched from a third party by every reader. An `image` node stores a URL, so the viewer's
browser contacts that host, which learns the viewer's IP address and when the card was opened. Each link
image renders with `referrerpolicy="no-referrer"`, `loading="lazy"` and `decoding="async"`, so the
workspace URL and share token are not sent along, and the URL itself is document content, so a share
reader can see it. The CSP allows `https:` in `img-src` for this reason; an `attachment` keeps readers off
third-party hosts.

## Recovery and device hygiene

The owner key exists in three places: this browser's local storage, the `.suitekey` recovery file saved
from File then Recovery key, and any owner link you copied. The `.suitekey` is plaintext JSON, so keep it
in a password manager or offline storage and never inside a `.suite` backup.

Forget this browser removes the owner key, the saved-download flag, the recent-workspace entry and the
cached document from that browser only. The workspace stays on the relay. Removing a launcher row or
clearing recents revokes nothing.

The launcher accepts a `.suitekey` through Open recovery key, for a browser without the workspace in its
recents. A file that is not a valid key shows one inline error and creates nothing.

On a shared device, use a private window and forget the browser afterwards. Browser sync can copy local
storage and history to other devices.

If every key copy is lost, an operator can reset ownership with `admin reset-owner`. The next browser to
open the workspace with an owner key then claims it, so coordinate the reset, because anyone who reaches
the workspace first can become the owner.

## Deployment expectations

TLS is required. Serve the app and the relay over HTTPS and WSS, do not expose the plaintext HTTP port,
and prefer one same-origin deployment. `SUITE_ALLOWED_ORIGINS` is the browser allowlist: unset answers a
loopback origin only, a list answers exactly those origins, and `*` answers any origin, which is a decision
an operator makes rather than a default.

Encrypt the host disk and the backups. SQLite has no encryption at rest in Suite, so use an encrypted
volume for the data directory and encrypt off-site backups.

Back up all six stores together. `documents`, `shares`, `workspaces`, `settings`, `licences` and
`attachments` live in separate files under `/data` in `compose.yaml`. Copy them while the server is
stopped, or use `deploy/backup.sh`, and include any `-wal` and `-shm` sidecars. A mixed backup can pair
documents with the wrong share rows, and one that omits `attachments` leaves every image as a permanent
placeholder, because the document stores only an id. Restore into a fresh volume with
`deploy/restore.sh`, and do not put these files on a network filesystem.

Run a single instance, because rooms, presence, projection state and rate-limit counters live in one Node
process and SQLite is local to it. There is no shared lock and no multi-replica mode; restarting drops live
sockets and not documents.

Expect rate limits and add proxy limits. The server applies in-process fixed-window limits per client
address to claim, rotate, share creation, token resolution and publish, and answers `429` with
`Retry-After`. Override with `SUITE_CLAIM_RATE_LIMIT`, `SUITE_ROTATE_RATE_LIMIT`,
`SUITE_SHARE_CREATE_RATE_LIMIT`, `SUITE_SHARE_RESOLVE_RATE_LIMIT` or `SUITE_PUBLISH_RATE_LIMIT`, and set
`SUITE_TRUST_PROXY=1` behind a trusted proxy. These limits stop casual abuse, not a determined flood, so
put request-size and connection limits in the reverse proxy too.

## Operator commands

There is no user-facing delete everywhere action. Destructive operations are SQLite commands run on the
host, and without `--force` they print the stop-the-server instruction and exit non-zero without opening a
database.

```sh
# Stop the collab server first. Deletes the owner hash; the workspace, shares
# and documents stay, and the next owner open claims it with a new key.
pnpm --filter @suite/collab-server admin reset-owner <workspaceId> --force

# Also revoke every share link and drop its draft baseline and projection.
pnpm --filter @suite/collab-server admin reset-owner <workspaceId> --revoke-shares --force

# Delete the workspace document, share rows, baselines, projected share
# documents and owner row.
pnpm --filter @suite/collab-server admin delete <workspaceId> --force
```

The commands read `SUITE_DB`, `SUITE_SHARES_DB` and `SUITE_WORKSPACES_DB`, which default to
`suite.documents.sqlite`, `suite.shares.sqlite` and `suite.workspaces.sqlite` relative to the package
directory when run through `pnpm --filter`. Deletion is immediate and cannot be undone, so take a backup
first.

