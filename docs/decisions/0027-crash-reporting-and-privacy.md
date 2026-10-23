# ADR-0027: Crash reporting and privacy

- **Status:** Accepted
- **Date:** 2026-10-23
- **Gate:** A6
- **Related:** ADR-0025 (client durability)

## Context

A render error that is caught by the error boundary (ADR-0025) produces a
diagnostic block the person can copy. That covers the tab in front of them, not
the crash nobody reported. Self-hosted Alpha needs a way for an operator to learn
about a failure without making the deployment depend on a vendor, and without
turning a document tool into a telemetry product.

The data at risk is specific and severe: card titles and bodies, attachment
names, document bytes, share tokens and the workspace owner key. A crash report
is not worth any of it.

## Decision

### A self-hosted GlitchTip, off by default

- `compose.crash.yaml` adds a `crash` profile running GlitchTip with its own
  Postgres and Redis. It is not part of the default `docker compose up`; the
  operator opts in with `--profile crash`.
- Nothing is sent to a third party. Events stay in the deployment's
  `glitchtip-data` volume.
- GlitchTip's own retention setting governs how long events live (default 90
  days). Retention is an operator decision recorded in the deployment notes, not
  a client-side TTL.

### Two independent gates: a DSN in the build, and consent in the browser

- The client initialises `@sentry/react` only when **both** are true:
  1. `VITE_SUITE_CRASH_DSN` is set at build time, and
  2. the person has ticked "send crash reports" (stored in local storage as
     `suite-crash-consent`).
- A build without a DSN never loads the SDK, never renders the consent control,
  and never imports the module: `startCrashReporting` is a dynamic import behind
  both checks.
- Consent is revocable from the storage panel. Revoking removes the preference
  and stops further reports from that browser.
- The SDK is configured with `maxBreadcrumbs: 0`, no session replay, no
  performance tracing and no default PII. The scrubber, not the SDK, decides what
  a payload contains.

### The payload is an allowlist, not a filtered event

`apps/canvas/src/crash/scrub.ts` builds a **new** object per event containing
only:

| Allowed | Source |
| --- | --- |
| build version | `VITE_SUITE_VERSION` (release) or `dev` |
| route | `safeRoute()` — fragment removed, `share` redacted |
| browser / OS | name and version, from the event's contexts or the UA |
| stack trace | exception type and frames (filename, function, line, column, `in_app`) |
| hashed workspace id | SHA-256 of the room id, truncated to 16 hex characters |
| event id, timestamp, level | Sentry's own identifiers |

Everything else is dropped by construction: card titles, card bodies, attachment
names, document bytes, share tokens, the owner key, `user`, `extra`, breadcrumbs,
device context and the exception **message** (free text that can quote a card).

### The owner key is a hard prohibition

- The owner key must never appear in the same payload as the hashed workspace id.
- After the allowlist is applied, the scrubber serialises the payload and
  searches it for the key. If it is present anywhere — a stack frame whose
  function name was interpolated from it, say — the **entire event is dropped**.
  A partial redaction is not attempted, because a payload that crossed that line
  cannot be trusted to be clean.
- `apps/canvas/src/crash/scrub.test.ts` asserts both halves: an event stuffed
  with card text, attachment names, share tokens and the owner key produces a
  payload containing none of them, and an event whose frames carry the key is
  discarded outright.

## Consequences

- An operator can see real failures without asking a user to reproduce them.
- The default deployment sends nothing anywhere, and a self-hoster who never sets
  a DSN still gets the local diagnostics bundle.
- The report is less useful than a full Sentry event: no breadcrumbs and no
  exception message makes some bugs harder to reproduce. Accepted — the
  diagnostics block the person can copy covers the rest.
- Any new field in a report must be added to the allowlist deliberately, with a
  test, which is the point.

## Alternatives considered

- **Vendor SaaS crash reporting.** Rejected for Alpha: it puts user documents'
  metadata through a third party for a self-hostable product, and the plan's
  decision table already chose GlitchTip.
- **Report on by default with an opt-out.** Rejected: the payload is derived from
  a document tool; consent must be affirmative.
- **Send the exception message but scrub it.** Rejected: message scrubbing is a
  denylist, and denylists miss the sentence nobody thought of.
- **Send the workspace id rather than a hash.** Rejected: the id is a relay room
  name and can be used to address the room.
