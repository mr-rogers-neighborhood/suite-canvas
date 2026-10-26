# Security policy

## Reporting a vulnerability

Open a private security advisory on the repository ("Security" → "Advisories" → "Report a
vulnerability"), or email the maintainer listed on the repository profile. Do not open a public issue
for anything that would let someone else read, write or destroy a workspace they were not given a
link to.

Include what you did, what happened and what you expected. A proof of concept against your own
instance is ideal; do not test against an instance you do not own.

There is no bug bounty. Acknowledgement within a few days, then a fix or an explanation as soon as the
maintainer can, is the commitment.

## Access model

Anonymous workspaces are the shipped path. Access travels as bearer links: an owner key for a
workspace, a share token for a share of it. The relay keeps documents in plaintext and keeps
credentials only as SHA-256 hashes. Document contents are not end-to-end encrypted, and nothing on the
relay attributes a change to a person.

An account layer exists in `services/auth`: organizations, roles, invitations and licensing. It is
built and tested, and no running process mounts it. The relay refuses an account session with
`account-check-unavailable` rather than guessing a seat count, and no process opens a Postgres pool.
[Security model](docs/reference/security-model.md) has the full picture, including what the account
layer will and will not change.

## In scope

- A credential accepted for the wrong room, or accepted after revocation.
- A share token that can mint or revoke another link.
- Path traversal or arbitrary file write through an attachment or a store path.
- Signature, HMAC or key-handling mistakes in the licence verifier or the Stripe webhook.
- Cross-site scripting through card content, attachment types or error pages.
- A rate limit that can be bypassed trivially.

## Known and accepted for Beta

- No end-to-end encryption. The relay can read every document it stores.
- Single instance, six SQLite stores on one volume, no multi-tenant isolation beyond the per-room
  credential check.
- No per-user attribution and no audit log for anonymous workspaces.
- Hosted billing is closed; a licence key is a signed token you hold.
- The account layer is not deployed, so no sign-in path is reachable on a running relay.

## Deployment expectations

TLS, disk encryption and coordinated backups belong to the operator. A plain-HTTP deployment cannot
sync and is not supported. `deploy/backup.sh` and `deploy/restore.sh` handle the volume as a whole.
See [Operate a deployment](docs/how-to/operate.md) and [Limits](docs/reference/limits.md).

## Supported versions

Beta releases are tagged `v0.2.0-beta.N`. Only the newest tag gets fixes; an older beta is expected to
be replaced, not patched.
