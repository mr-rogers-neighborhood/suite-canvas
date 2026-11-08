# ADR-0097: The agent runs in a microVM, and the tools stay on the host

- Status: partial
- Date: 2026-11-04
- Related: ADR-0080, `.mcp.json`, `scripts/sandbox.mjs`, `scripts/sandbox-canary.mjs`,
  `docs/how-to/sandbox.md`
- Shipped: the launch script, the canary, the host-side MCP registrations and the runbook. `.mcp.json`
  no longer offers the credential-minting tool.
- Remaining: one full session inside the sandbox, recorded in the runbook, and a decision on whether
  the canary runs before every session or on demand.

## Decision

A coding session runs inside a Docker Sandbox: its own kernel, its own Docker daemon, and a private
clone of this repository, with the host checkout mounted read-only. The three MCP servers stay on the
host behind the sandbox's MCP gateway, so `cloudflare`, `resend` and `cloudwatch` run with host
credentials and the agent only ever holds tool calls.

`git push`, tags and `deploy/` are host actions. The agent commits in its clone and the commit comes
home as a patch.

## Rejected alternatives

- **Locki.** The better worktree story and the better ergonomics for one agent: a Lima VM plus Incus
  containers, one git worktree per conversation, and a host `git`/`gh` bridge that only accepts
  `#locki-` branches. Rejected as the primary because its own README says there is no exfiltration
  protection and MCP servers run inside the sandbox with their tokens, which is the half this decision
  is about. Kept as the named fallback.
- **A dev container.** Shared kernel, and the recipes mount the Docker socket, which is root on the
  host.
- **Landlock, bubblewrap or a firejail profile.** A useful boundary for one untrusted binary and the
  wrong one for an agent that runs installs and test suites for an hour, on the same kernel.
- **An Incus container built by hand.** Viable on Arch (`incus` is in `extra`) and the most control.
  It also means owning the boot, the mounts and the MCP bridge, which is three pieces of
  infrastructure to maintain for a boundary that `sbx` already draws.
- **Keeping `resend`'s `create-api-key`.** It mints a credential, and a host-brokered gateway would
  hand that to any session that reads untrusted text.

## Consequences

- The agent cannot reach `~/.aws`, `~/.config/gh` or `.env`, which it could before. A prompt injection
  can still call the MCP tools that remain, so the allowlist is the control and it stays short.
- A sandbox is not free: the first run pulls an agent image and an Arch host runs on a release
  artifact rather than a supported package.
- The boundary is only claimed when `pnpm sandbox:check` says so, so the canary is part of the
  workflow rather than a demonstration.
- If `sbx` disappoints on Arch, the canary and the broker survive a move to Locki. The launch script is
  the only file that assumes `sbx`.
