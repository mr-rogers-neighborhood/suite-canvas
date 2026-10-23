# Security policy

## Reporting a vulnerability

Email the maintainer listed on the repository profile, or open a private
security advisory on the repository ("Security" → "Advisories" → "Report a
vulnerability"). Do not open a public issue for anything that would let someone
else read, write or destroy a workspace they were not given a link to.

Please include what you did, what happened, and what you expected. A proof of
concept against your own instance is ideal; do not test against an instance you
do not own.

There is no bug bounty. Acknowledgement within a few days and a fix or an
explanation as soon as the maintainer can is the commitment.

## What is in scope

Suite has no accounts. Access travels as bearer links: an owner key for a
workspace, a share token for a share of it. The relay stores documents in
plaintext and stores credentials only as SHA-256 hashes. The full model is in
[docs/security-model.md](docs/security-model.md).

In scope:

- A credential accepted for the wrong room, or accepted after revocation.
- A share token that can mint or revoke another link.
- Path traversal or arbitrary file write through an attachment or a store path.
- Signature, HMAC or key-handling mistakes in the licence verifier or the
  Stripe webhook (`services/billing`, not deployed for the alpha).
- Cross-site scripting through card content, attachment types or error pages.
- A rate limit that can be bypassed trivially.

Known and accepted for the alpha, not vulnerabilities to report:

- No end-to-end encryption. The relay can read every document it stores.
- Single instance, single SQLite file set, no multi-tenant isolation beyond the
  per-room credential check.
- No accounts, no per-user attribution, no audit log.
- Hosted billing is closed; a licence key is a signed token you hold, not an
  account.

## Deployment expectations

TLS, disk encryption and coordinated backups are the operator's job. A
plain-HTTP deployment cannot sync and is not supported. See
[docs/operations.md](docs/operations.md) and [docs/limits.md](docs/limits.md).

## Supported versions

Alpha releases are tagged `v0.2.0-alpha.N`. Only the newest tag gets fixes; an
older alpha is expected to be replaced, not patched.
