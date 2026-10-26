# Security model

Suite is link-based, not account-based. There is no sign-up, no email, no password reset and no
user identity on the relay. Every credential is a **bearer capability**: whoever holds the link
has the capability, and the server cannot tell two holders apart.

This page states what each credential grants, what the relay can see, and what an operator has to
do to run it safely. It describes the current architecture; it is not a promise of end-to-end
encryption.

## Capabilities

| Credential | Shape | Grants | Does not grant |
| --- | --- | --- | --- |
| **Owner link** | `?workspace=<id>#owner=<key>` | Full read/write access to the workspace, creating/listing/revoking share links, and rotating the owner key. | Recovery of a lost key; the relay stores only its hash. |
| **Workspace editor token** | `?share=<token>` | Read/write access to the workspace document and its presence. | Managing links, rotating the owner key, or claiming the workspace. |
| **Workspace viewer token** | `?share=<token>` | Read-only access to the workspace document. | Any write, link management, or learning the owner key. |
| **Board or card viewer link** | `?share=<token>` | Read-only access to a live projection of that board or card. | The workspace index or workspace id; any write. |
| **Selection viewer link** | `?share=<token>` | Read-only access to a live projection of the selected cards on one board, the geometry of the sections those cards occupy, and the titles of cards they reference (marked "not shared"). | The unselected cards, the workspace index or id, the ids of the selected cards, or any write. |
| **Board or card editor link** | `?share=<token>` | Editing a draft in its own `share-<token>` room, then publishing that draft. | Writing the workspace directly or managing links. The server validates and conflict-checks the publish. |
| **Internal worker tokens** | `SUITE_PROJECTION_TOKEN` (legacy `SUITE_INTERNAL_TOKEN`) / `SUITE_SOURCE_TOKEN` | Server-to-server access used by the projection worker. The projection token writes only projection rooms; the source token writes only a workspace with an active editor share. | Nothing user-facing. They must never be given to a browser or logged. When unset, each server start generates random tokens. |

The owner key is 32 random bytes generated in the browser and kept in local storage plus the URL
fragment. The relay stores only a SHA-256 hash. Share tokens are also random, stored only as
SHA-256 hashes, and resolved per room as `read` or `write`. A share token can never mint or revoke
another link; that needs the owner key.

Workspace editor tokens are the right way to invite someone to edit. Do not send the owner link as
“editor”: it also lets the holder manage links and rotate the owner key.

Inside the app these rows are explicit capabilities rather than one read-only switch:
`canEditContent`, `canEditLayout`, `canCreateContent`, `canCreateBoards`, `canManageBoards`,
`canManageSchema`, `canManageTrash`, `canPublish` and `canManageLinks`. A workspace editor token
gets the live workspace surface — boards, types, tags and the trash — but no `WorkspaceActions`
(share, export, recovery) and no link or owner-key controls. A board draft can create cards,
sections and edges and edit what it publishes; a card draft edits only its card. Neither can create
boards, schema, trash or links.

## When accounts exist

Everything above is the model as it runs today, and it stays true for every workspace that has no
organization behind it. Accounts add an *ownership layer* on top ([ADR-0065](decisions/0065-accounts-own-workspaces.md));
they do not replace the capability model, and the capability model is not a fallback that gets worse
once you sign in.

**What changes.** An organization is the tenant and owns many workspaces; a `member` row with a role
(`owner`, `admin`, `member`) replaces "whoever holds the link" for the people inside it. The role
becomes the app's capability flags through one mapping (`capabilitiesForRole` in `services/auth`), and
those flags are what the UI reads — the same nine flags a share session gets. Claiming an anonymous
workspace sets its organization and changes nothing else: the document id, its URL and every share
link already handed out keep working, so adopting an account is never a migration of the work.

**What stays.** The owner key is still the offline key — the only way to open a workspace when the
control plane is unreachable — and share links still grant exactly what their role says. Revoking a
link, rotating the owner key and the operator commands above behave the same. Anonymous workspaces
(no organization) are still first-class, still ungated by any licence, and still need no login.

**One resolver, one precedence: session > owner key > share token.** A request may carry all three.
The session wins *only* if it names the organization that owns this workspace and the account still
has a `member` row there; otherwise the owner key applies, and otherwise the share token. Two
consequences worth knowing before you read a bug report:

- A signed-in person opening someone else's share link is a **share holder**, not an account: their
  session names a different tenant, so it does not shadow the link.
- Someone removed from an organization who still holds an owner link or a share link keeps that
  access. Removing a member row is not a revocation of the capabilities the workspace handed out;
  rotate the owner key and revoke the links, exactly as before.

**The check is server-side or it is decoration.** The relay verifies the Ed25519 licence and, at the
moment a socket joins, refuses a workspace whose licence is missing or expired — a lapsed licence
loses *sync*, never local data. Seats and the per-organization workspace ceiling are decided by the
control plane from its own rows (member counts, non-archived workspaces), never from a client claim.
A websocket carries an owner key or a share token, not a session, so the relay refuses an *account*
credential until the browser side sends one: guessing a seat count there would be worse than
refusing.

**New material to protect.** The control-plane database holds accounts, sessions, passkeys,
organizations, members, invitations and invite-key **hashes** — no document bytes, ever. Invite keys
and magic-link tokens are bearer capabilities for as long as they last: an invite key is a SHA-256
hash at rest, single-purpose (it grants admin or member, never ownership), expiring and revocable, and
redeeming it writes one `member` row. A leaked key is fixed by revoking the row, the same way a leaked
link is fixed by revoking the share.

## What the relay can see

- **Documents are plaintext.** SQLite stores the full Loro snapshot of every workspace and every
  projected share room. The server process can read all cards, boards and content. There is no
  end-to-end encryption.
- **Attachment bytes are plaintext too.** Uploaded images live in their own store beside the
  documents, protected only by a 128-bit unguessable id: anyone holding the id can read the bytes,
  and the operator can read all of them. An SVG or HTML upload is refused precisely because a
  served attachment must never be executable content.
- **Credentials are hashed.** Owner keys and share tokens are stored as SHA-256 hashes, never in
  plaintext. A stolen database does not directly hand out working credentials.
- **A live socket keeps its credential in memory.** The relay's revoke path has to decide *which*
  open sockets belong to a share or an owner key it just invalidated, so the patched sync server
  keeps each socket's credential per joined room for as long as the socket is connected; it is
  cleared on leave and on disconnect (see `patches/loro-websocket@0.6.2.patch`). This is retention,
  not new exposure: the same process holds every document in plaintext, so anyone who can read the
  process's memory already has the content and needs no credential. What it does mean is that
  "hashed at rest" should not be read as "never present in memory" — a heap dump from a running
  relay contains the credentials of everyone currently connected, exactly as it would for any
  server that authenticates a connection once and keeps it open.
- **Links are still the weak point.** An owner key travels in the URL fragment and in the
  `Authorization` header for owner API calls. A share link's token is now exchanged, on first open,
  for a short-lived `HttpOnly` session cookie; the browser then replaces the URL so the token is no
  longer in the address bar or in forward history, and every later request carries the session id
  (15-minute TTL, hashed at rest, deleted when the share is revoked). Browser history, clipboard
  managers, chat backups and proxy logs can still capture the link itself the moment it is shared,
  and a session id captured in transit is a credential for up to its TTL — which is why the TTL is
  short and revocation ends live sessions rather than only blocking new joins.
- **Sessions are scoped and disposable.** A share session authenticates exactly one share's room;
  it cannot join another room, cannot outlive its share, and is deleted with it on revoke or expiry.
- **No accounts means no attribution.** The relay cannot say who created or edited a card. Presence
  (names, pointers, carets) is ephemeral and is not written to the document. Every editor using a
  link shares that link's identity.
- **Metadata exists.** Workspace ids, board/card ids in share rows, creation, last-use and
  revocation timestamps, and the IP addresses seen by the server or its proxy are visible to the
  operator. Last-used is coarse (one write a minute at most) and only says a link was opened, not
  by whom.
- **Backups are unencrypted.** All six SQLite stores and `.suite` exports contain the same
  plaintext documents, every uploaded image, and the licence and quota bookkeeping, and are not
  encrypted by Suite.

## Sharing risks

- Anyone who receives a link can forward it, copy it, or screenshot the workspace. Revoking a link
  cannot take back what was already read.
- A share token in a URL can leak through access logs, analytics, screenshots or browser sync.
  Serve the app with a restrictive `Referrer-Policy` and do not log query strings.
- A leaked **owner link** is full ownership. Revoke the affected share links and rotate the owner
  key from `File → Recovery key…`. Rotation invalidates the old owner link and old `.suitekey`
  files, and revokes every share link by default; uncheck that option only when collaborators
  should keep their links.
- A leaked **share link** is fixed by revoking that link. Revocation stops new joins, closes open
  sockets and removes the projected draft; it does not change the workspace.
- Share links can be set to expire after 7 or 30 days, or never. Delete links you no longer need,
  and keep the number of active links small.
- **A link image is fetched from a third party by every reader.** An `image` node stores a URL, not
  bytes, so the viewer's browser contacts that host, which learns the viewer's IP address and when
  the card was opened. Each link image renders with `referrerpolicy="no-referrer"`, `loading="lazy"`
  and `decoding="async"` so the workspace URL and share token are not sent along, and the URL itself
  is part of the document — a share reader can see it. The CSP allows `https:` in `img-src` for this
  one reason; that relaxation is the cost of supporting link images, and an `attachment` (bytes
  stored beside the document) is the option that keeps readers off third-party hosts.

## Recovery and device hygiene

- The owner key exists in three places: this browser's local storage, the `.suitekey` recovery file
  saved from `File → Recovery key…`, and any owner link you copied. The `.suitekey` is a plaintext
  JSON file; keep it in a password manager or offline storage, never in a `.suite` backup.
- `File → Recovery key… → Forget this browser` removes the owner key, the saved-download flag, the
  recent-workspace entry and the cached document from that browser only. The workspace stays on the
  relay. Removing a launcher row (“Remove from this list”) or clearing recents does not revoke
  anything and does not delete the workspace.
- The launcher accepts a `.suitekey` with **Open recovery key…**, for a browser that does not have
  the workspace in its recents. A file that is not a valid key for a workspace shows one inline
  error and creates nothing.
- On a shared or borrowed device, use a private window and forget the browser afterwards. Browser
  sync can copy local storage and history to other devices.
- If every key copy is lost, an operator can reset ownership with `admin reset-owner`. The next
  browser to open the workspace with an owner key then claims it, so coordinate that reset: anyone
  who reaches the workspace first can become the owner.

## Deployment expectations

- **TLS is required.** Serve the app and the relay over HTTPS/WSS. Do not expose the plaintext HTTP
  port. Use one same-origin deployment where possible; allowlist CORS instead of `*`.
- **Encrypt the host disk and backups.** SQLite has no encryption at rest in Suite. Use an
  encrypted volume for the data directory, and encrypt off-site backups.
- **Back up all six stores together.** Six stores exist in code (`documents`, `shares`,
  `workspaces`, `settings`, `licences`, `attachments`) and `compose.yaml` writes all six to
  `/data`. Documents, shares, owner hashes, quota overrides, licence claims and attachment bytes are
  separate files. Copy them while the server is stopped (or use `deploy/backup.sh`, which takes a
  consistent SQLite backup of each) and include any `-wal`/`-shm` sidecars. A mixed backup can pair
  documents with the wrong share rows, and one that omits `attachments` leaves every image as a
  permanent placeholder: the document stores only an id, so the bytes are unrecoverable from the
  text. Restore into a fresh volume with `deploy/restore.sh`, and do not put these files on a
  network filesystem.
- **Run a single instance.** Rooms, presence, projection state and rate-limit counters live in one
  Node process, and SQLite is local to it. There is no Redis/Postgres, no shared lock and no
  multi-replica mode. Restarting the process drops live sockets, not documents.
- **Expect rate limits, and add proxy limits.** The server applies small in-process fixed-window
  limits per client address to claim, rotate, share creation, token resolution and publish, and
  answers with `429` and `Retry-After` (override with `SUITE_*_RATE_LIMIT`; set
  `SUITE_TRUST_PROXY=1` behind a trusted proxy). These limits protect the database from casual
  abuse, not from a determined flood. Put a request-size and connection limit in the reverse proxy
  too.

## Operator commands

The relay has no user-facing “delete everywhere” action. Destructive operations are plain SQLite
commands that must be run on the host:

```sh
# Stop the collab server first, then delete the owner hash. The workspace,
# shares and documents stay; the next owner open claims it with a new key.
pnpm --filter @suite/collab-server admin reset-owner <workspaceId> --force

# Also revoke every share link and drop its draft baseline and projection.
pnpm --filter @suite/collab-server admin reset-owner <workspaceId> --revoke-shares --force

# Delete the workspace document, share rows, baselines, projected share
# documents and owner row.
pnpm --filter @suite/collab-server admin delete <workspaceId> --force
```

Without `--force` both commands print the “stop the server first” instruction and exit non-zero
without opening the databases. The commands read `SUITE_DB`, `SUITE_SHARES_DB` and
`SUITE_WORKSPACES_DB` (defaults `suite.documents.sqlite`, `suite.shares.sqlite` and
`suite.workspaces.sqlite`, relative to the package directory when run through `pnpm --filter`).
Deletion is immediate and cannot be undone; take a backup first.

## Not in this model

- No audit trail of who changed what. Accounts and organizations exist behind `SUITE_AUTH_ENABLED`
  (see "When accounts exist"), but they attribute nothing inside a document: presence is still
  ephemeral, and the document itself records no author.
- No end-to-end encryption and no encrypted backups.
- No multi-replica relay or external database.
- No user-facing permanent delete.
