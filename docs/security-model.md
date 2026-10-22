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
| **Board or card editor link** | `?share=<token>` | Editing a draft in its own `share-<token>` room, then publishing that draft. | Writing the workspace directly or managing links. The server validates and conflict-checks the publish. |
| **Internal worker tokens** | `SUITE_PROJECTION_TOKEN` (legacy `SUITE_INTERNAL_TOKEN`) / `SUITE_SOURCE_TOKEN` | Server-to-server access used by the projection worker. The projection token writes only projection rooms; the source token writes only a workspace with an active editor share. | Nothing user-facing. They must never be given to a browser or logged. When unset, each server start generates random tokens. |

The owner key is 32 random bytes generated in the browser and kept in local storage plus the URL
fragment. The relay stores only a SHA-256 hash. Share tokens are also random, stored only as
SHA-256 hashes, and resolved per room as `read` or `write`. A share token can never mint or revoke
another link; that needs the owner key.

Workspace editor tokens are the right way to invite someone to edit. Do not send the owner link as
“editor”: it also lets the holder manage links and rotate the owner key.

## What the relay can see

- **Documents are plaintext.** SQLite stores the full Loro snapshot of every workspace and every
  projected share room. The server process can read all cards, boards and content. There is no
  end-to-end encryption.
- **Credentials are hashed.** Owner keys and share tokens are stored as SHA-256 hashes, never in
  plaintext. A stolen database does not directly hand out working credentials.
- **Links are still the weak point.** A share token travels in a URL query string; an owner key
  travels in the URL fragment and in the `Authorization` header for owner API calls. Browser
  history, clipboard managers, chat backups and proxy logs can capture them.
- **No accounts means no attribution.** The relay cannot say who created or edited a card. Presence
  (names, pointers, carets) is ephemeral and is not written to the document. Every editor using a
  link shares that link's identity.
- **Metadata exists.** Workspace ids, board/card ids in share rows, creation and revocation
  timestamps, and the IP addresses seen by the server or its proxy are visible to the operator.
- **Backups are unencrypted.** The three SQLite files and `.suite` exports contain the same
  plaintext documents and are not encrypted by Suite.

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
- **Back up all three databases together.** Documents, shares and owner hashes are separate SQLite
  files. Copy them while the server is stopped (or with a consistent SQLite backup) and include any
  `-wal`/`-shm` sidecars. A mixed backup can pair documents with the wrong share or owner rows.
  Restore into a fresh volume, and do not put these files on a network filesystem.
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

- No accounts, email, OAuth, organizations or per-user ACLs; no audit trail of who changed what.
- No end-to-end encryption and no encrypted backups.
- No multi-replica relay or external database.
- No user-facing permanent delete.
