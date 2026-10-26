# @suite/site

The marketing page for `suite.run`: one Astro page, no framework, no client
script. It says what Suite is, links to the app and the docs, and lists the two
hosted plans with the caps a licence carries.

```sh
pnpm site:dev           # astro dev, http://localhost:3002
pnpm site:build         # static output in apps/site/dist
```

`apps/site/Dockerfile` builds the tree and serves it with Caddy on port 3002 at
`/srv/marketing`, which is what `deploy/Caddyfile` expects for
`SUITE_MARKETING_ROOT`.

The plan names and caps come from the tier table the hosted licence is minted
from (`services/billing/src/stripe/tiers.ts`, published in
[`docs/reference/billing.md`](../../docs/reference/billing.md)). Prices are not
on this page because they live in Stripe, not in the repository.
