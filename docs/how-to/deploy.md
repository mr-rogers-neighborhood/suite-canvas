# Deploy a server

One small instance, one Docker host, one `app` container, six SQLite stores on one volume, Caddy in
front, Cloudflare in front of Caddy.

```
visitor ──▶ Cloudflare (proxy, WAF, cache bypass) ──▶ :443 Caddy ──▶ app:1235 /api, /health, /metrics
                                                          └──────▶ app:1234 /ws
                                                                     │
                                                          /data volume (six stores)
```

There is no second replica, no shared database and no zero-downtime deploy: rooms, presence,
projection state and rate-limit counters live in the `app` process, and SQLite is a local file. Scale
comes from another instance with its own workspaces. Day-two tasks are in [operate.md](operate.md);
the quotas are generated into [reference/limits.md](../reference/limits.md). Paths below assume the
repo at `/srv/suite`, compose project `suite`, hostname `canvas.example.com`.

## The AWS path, in order

The sections below are the shape of a deployment in general. This is the same thing as a checklist for
one AWS account in `us-east-2`, with the console page each step lives on, because the order matters:
the IAM role has to exist before the instance can assume it, and the bucket has to exist before a
backup can land in it.

| # | What | Where | Section |
| --- | --- | --- | --- |
| 1 | Bucket for dumps and snapshots, private, versioned, 30-day expiry | S3, `suite-backups-<account>-use2` | [§7](#7-backups-and-the-mount-guard) |
| 2 | Instance role from `deploy/iam/instance-role-policy.json`, named `suite-host` | IAM, Policies then Roles, EC2 use case | §2 |
| 3 | Security group: 80 and 443 from the world, 22 from your address only | EC2, Security Groups | §4 |
| 4 | `t4g.medium` Ubuntu 24.04 arm64, 30 GB gp3 root, user-data from `deploy/user-data.sh` | EC2, Launch instance, Advanced details | §1, §2 |
| 5 | Elastic IP, associated once the instance is running | EC2, Elastic IPs | §5 |
| 6 | Data volume, gp3 20 GB, same availability zone, attached and mounted | EC2, Volumes | §3 |
| 7 | RDS Postgres `db.t4g.micro`, private, same VPC, TLS required | RDS, Create database | [below](#the-account-service-on-a-hosted-launch) |
| 8 | One `A` record, DNS only, at the Elastic IP | Cloudflare DNS | §5 |
| 9 | `tailscale up --ssh` on the box, then the panel over the tailnet | Tailscale admin | §5 |
| 10 | Five alarms and one topic | `deploy/cloudwatch/setup.sh` | [operate.md](operate.md) |
| 11 | Stripe products and prices in test, then live; one 100%-off promotion | Stripe dashboard, then `/admin/settings` | below |
| 12 | Resend domain and API key, Turnstile site and secret keys | Resend, Cloudflare Turnstile, then `/admin/settings` | below |
| 13 | `docs.suite.run` and the marketing page as static builds | Cloudflare Pages | [Docs and marketing](#docs-and-marketing) |

Two of those steps are the ones people get wrong. The first is the key pair: a Tailscale-only box needs
none for daily use, but a box with neither a key pair nor a working tailnet has no way in at all, so
create one anyway and keep it as the break-glass path. The second is the database URL: it has to name
the RDS endpoint, and the compose default names a `postgres` service that this host does not run.
`deploy/preflight.sh` asks a finished `.env` for both, and for the rest of the failures that a boot
does not name itself (§6).

Every secret in the list lands in one of two places, and neither is a file in the repository. The
control plane reads the values the panel owns from settings rows encrypted with `SUITE_SETTINGS_KEY`,
so Stripe, Resend and Turnstile keys go in at `/admin/settings` and are invisible to `docker exec`. The
rest (the auth secret, the two relay tokens, the database URL) go in `/srv/suite/.env` with mode 600,
written once by hand. `deploy/backup.sh` reads the same file.

## 1. Pick a size

The process holds every open room in memory. Loading a room and rebuilding a share projection are the
expensive operations; a 5 000-card board costs seconds per rebuild, per open link.

| Instance | Comfortable load | Why |
| --- | --- | --- |
| 1 vCPU / 2 GB (Lightsail, `t4g.small`) | A handful of workspaces, ~10 concurrent editors | ~1 GB left for rooms, resident only while someone is connected. |
| 2 vCPU / 4 GB (`t4g.medium`) | Dozens of editors, thousands of workspaces, board shares | Rebuilds are CPU-bound and hold the event loop; a second core absorbs them. |
| 4 vCPU / 8 GB (`t4g.large`) | Hundreds of workspaces, heavy share use | Still one process. Past this, split workspaces across instances. |

Measure instead of guessing: `/api/admin/status` has store sizes, rooms and clients, and `/metrics` has
`suite_rss_bytes`, `suite_open_rooms` and `suite_projection_rebuilds_total`. `mem_limit` in
`compose.yaml` turns a leak into a container restart instead of an OOM kill of the box. The volume is
gp3, 20 GB minimum and encrypted at creation, because the application has no encryption at rest.

That table is about serving. The same host also *builds* each release (§9), and the build needs more
than the process does: 4 GB of memory and about 30 GB of root disk, on top of the data volume. A 2 GB
instance serves a small deployment and then fails `pnpm build`, so either add swap or resize for the
upgrade. §9 has both remedies and the numbers.

## 2. Create the instance and install Docker

Lightsail: Ubuntu 24.04, 2 GB, static IP attached. EC2: Ubuntu 24.04 LTS, `t4g.small`, Elastic IP,
security group from step 4. Instance store is not durable; root EBS is. Give the root volume 30 GB,
because the build in §9 writes `node_modules`, the pnpm store and image layers there; the 2 GB
Lightsail plan already includes 60 GB.

The instance's user-data does the installing: `deploy/user-data.sh` brings up Docker from
Docker's repository, `sqlite3`, the AWS CLI, Tailscale and a 2 GB swap file, creates the
`suite` user in the `docker` group, and stops there.

```sh
aws ec2 run-instances --region us-east-2 \
  --image-id "$(aws ssm get-parameters --region us-east-2 \
    --names /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id \
    --query 'Parameters[0].Value' --output text)" \
  --instance-type t4g.medium --key-name suite-host \
  --iam-instance-profile "Name=suite-host" \
  --security-group-ids sg-… --subnet-id subnet-… --user-data file://deploy/user-data.sh \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3,Encrypted=true}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=suite-app}]'
```

`--key-name` is the break-glass path and it is not optional by accident: Tailscale is what you use
every day, but a tailnet that failed to come up on a fresh box would otherwise leave no way in at all.

Then, once, by hand (both are decisions rather than setup):

```sh
sudo -iu suite
git clone <your remote> /srv/suite
sudo tailscale up --ssh        # optional: prints a URL; click it and SSH and /admin arrive over the tailnet
```

A **private** repository needs credentials on the host, and the smallest credential that works is a
read-only deploy key per repository rather than a personal token that also reads every other one:

```sh
sudo -iu suite
ssh-keygen -t ed25519 -N '' -C 'suite host' -f ~/.ssh/suite_deploy
gh repo deploy-key add ~/.ssh/suite_deploy.pub --title 'suite host' --allow-write=false   # from a workstation
git clone git@github.com:<owner>/<repo>.git /srv/suite                                    # on the host
```

Reaching the operator panel needs no tailnet: `SUITE_OPERATOR_ALLOW` already admits loopback, so an
SSH tunnel terminates inside it.

```sh
ssh -N -L 8443:127.0.0.1:443 suite@<host>      # then, locally:
curl -fsS --resolve suite.example.com:8443:127.0.0.1 https://suite.example.com:8443/admin.html
```

The same request from the public internet answers `403 Not found`, because the door only admits the
networks named there. That is the cheapest way to prove the panel is not exposed: one probe from each
side.

`deploy/operator-tunnel.sh` opens that tunnel and prints the two URLs, so the command above does not
have to be remembered:

```sh
deploy/operator-tunnel.sh --host <elastic-ip>          # or SUITE_TUNNEL_HOST
deploy/operator-tunnel.sh --host <elastic-ip> --print  # just show the commands
```

**A browser cannot pass `--resolve`.** Visiting `https://127.0.0.1:8443` sends `127.0.0.1` as the
hostname, Caddy finds no site block for it, and the panel does not appear. Either add
`127.0.0.1 app.suite.run` to `/etc/hosts` while the tunnel is up, or take the simpler route for a
person at a known address: put that address in `SUITE_OPERATOR_ALLOW` and use
`https://app.suite.run/admin.html` directly.

```sh
# your own address, from the machine you will browse from
curl -s https://api.ipify.org; echo
# then: SUITE_OPERATOR_ALLOW=127.0.0.1/32 ::1/128 172.16.0.0/12 <that-address>/32
#       docker compose up -d --no-build --force-recreate caddy
```

That is a list of networks, so it excludes everyone else; drop the entry when the address changes. A
home connection's address moves, which is the argument for the tunnel as the durable path and the
allowlist as the convenient one.

**Who is an operator is decided by address, not by a role.** `SUITE_ADMIN_EMAILS` names the accounts
that may use the panel, and the check compares the signed-in address against that list. There is no
grant step and nothing to click: create the account, sign in, and the panel answers. An address that
is not on the list gets `403 forbidden` and a sentence saying so, which is the honest answer rather
than a lockout.

The host needs the checkout because it builds every image it runs: `caddy` bakes `deploy/Caddyfile`
and the canvas bundle, and `app` is compiled here from the same tree (§9). Nothing is pulled from a
registry, so the clone is part of the deployment.

## 3. Attach the data volume

Create the gp3 volume in the same availability zone and attach it. On Nitro it appears as
`/dev/nvme1n1`; confirm with `lsblk`.

```sh
sudo file -s /dev/nvme1n1          # "data" = unformatted, safe to mkfs
sudo mkfs.ext4 /dev/nvme1n1 && sudo mkdir -p /mnt/suite-data
sudo blkid /dev/nvme1n1            # copy the UUID into this fstab line:
# UUID=0f0e… /mnt/suite-data ext4 defaults,nofail,x-systemd.device-timeout=10s 0 2
sudo mount -a && mountpoint /mnt/suite-data
sudo docker volume create --driver local \
  --opt type=none --opt device=/mnt/suite-data --opt o=bind suite_suite-data
docker volume inspect suite_suite-data      # confirms the bind
```

`nofail` keeps a slow attach from making the instance unreachable over SSH, and it creates a trap: the
box then boots with `/mnt/suite-data` as an empty directory on the root disk, and a careless start
would create six fresh databases there and look like data loss. The mount guard in step 7 catches
that. Create the volume before the first `docker compose up`, because compose names volumes
`<project>_<volume>`.

## 4. Security group

| Port | Source | Why |
| --- | --- | --- |
| 80/tcp | `0.0.0.0/0` or [Cloudflare ranges](https://www.cloudflare.com/ips-v4) | HTTP to HTTPS redirect and ACME HTTP-01. |
| 443/tcp | `0.0.0.0/0` or Cloudflare ranges | The only public application port. |
| 22/tcp | your IP /32 only | SSH. |

`1234` and `1235` are exposed inside the compose network and never published, so the admin API and
`/metrics` go through Caddy, or from a container in the `app` network namespace:

```sh
docker run --rm --network "container:$(docker compose ps -q app)" curlimages/curl:8 \
  -fsS http://127.0.0.1:1235/metrics | head
```

## 5. DNS and Cloudflare

One proxied `A` record: `canvas` pointing at the Elastic or static IP. Before the first certificate
exists, leave it DNS-only, or keep it proxied with Always Use HTTPS off. The first Let's Encrypt
validation needs plain HTTP on port 80, and the edge redirect refuses it before Caddy can answer.

- SSL/TLS: Full (strict), minimum TLS 1.2, then Always Use HTTPS. HSTS comes from Caddy, so leave
  Cloudflare's off.
- WAF rate limit: one rule, since Free allows one, on `starts_with(http.request.uri.path,
  "/api/shares") or starts_with(http.request.uri.path, "/api/admin")` at 120 requests per minute per
  IP, action Block. A challenge page in front of a JSON API is useless to a client.
- Cache: a Bypass rule for `/api/` and `/ws`, and Browser Cache TTL set to Respect Existing Headers so
  Caddy's one-year `immutable` on `/assets/*` survives. Never Cache Everything: `index.html` and
  `admin.html` are `no-store` on purpose.
- Network: WebSockets and Brotli on; Rocket Loader, Email Obfuscation and Under Attack Mode off.
  Rocket Loader breaks ES modules and the WASM bundle.
- Client addresses: with the proxy on, Caddy sees the edge. Leave `SUITE_TRUST_PROXY=0` unless you also
  set Caddy's `trusted_proxies` for Cloudflare's ranges, or every visitor of one edge shares a
  rate-limit bucket. The operator door below depends on seeing the real address, which is why the app
  host is DNS-only.

### The operator door

`/admin.html`, `/admin/*` and `/api/admin/*` are gated by the **account**, not the network: the panel
asks the control plane who is signed in and whether that address is in `SUITE_ADMIN_EMAILS`, answers
401 without a session and 403 for a signed-in account that is not an operator. That is what lets the
panel work from a phone or a hotel, where an address-based rule cannot.

`/metrics` is the exception and stays address-gated by `SUITE_OPERATOR_ALLOW`, because it carries room
and memory counts and a scraper has no business reaching it from the internet.

The panel used to sit behind the same address rule, and the cost of that decision was an owner who
could not reach their own deployment from anywhere but one connection. The trade is discoverability:
`/admin.html` is reachable by anyone, and the lock is the session plus the operator list.

**What `SUITE_OPERATOR_ALLOW` must contain on a compose host** is not obvious, and getting it wrong
breaks the metrics scrape. Measured on a running stack, twice:

| Client | Address the door sees |
| --- | --- |
| a browser on the internet | its own public address, preserved through the port mapping |
| a request from the host itself, including an SSH tunnel to `127.0.0.1:443` | the Docker **bridge gateway** (`172.17.0.1`, `172.18.0.1`, …), not loopback |

So a list of loopback alone refuses the tunnel, and the bridge subnet is both safe and necessary:
external addresses keep their identity, which is why `172.16.0.0/12` cannot be spoofed from outside.
The compose default already carries it, so leave it there, and delete the tailnet entry only if you are not
using one. The probe in `deploy/cloudwatch/probe.sh` scrapes inside the relay's namespace, which is what
makes the loopback entry sufficient for it.

Tailscale's personal plan is free and covers this. Install it on the box (the instance user-data does),
run `tailscale up --ssh`, and connect your laptop: `ssh` and the panel both arrive over the tailnet, so
port 22 never has to be open. A local `docker compose` stack sets `SUITE_OPERATOR_ALLOW` to the Docker
bridge instead, because a browser on that machine arrives through it and is in no tailnet.

An external monitor on `https://canvas.example.com/health`, expecting `200 {"ok":true}`, catches the
instance being down; `deploy/alert.sh` from cron catches it being sick. The control plane's own
`/health` on `:1236` is the money path's: it runs `SELECT 1` on every request and answers `503` with
`checks: [{name: "database", state: "failed"}]` while Postgres is unreachable, so an RDS failover is
visible rather than silent. Nothing has to be restarted afterwards, because the next request opens a
fresh connection. That retry is why every pool here takes an `error` listener: an idle client dying is
a warning in the log instead of a crash.

## 6. First boot

```sh
cd /srv/suite && cp .env.example .env && chmod 600 .env
openssl rand -base64 32     # SUITE_PROJECTION_TOKEN
openssl rand -base64 32     # SUITE_SOURCE_TOKEN
```

Set `SUITE_DOMAIN` and `SUITE_ACME_EMAIL`. Leave `SUITE_IMAGE` commented: the build below writes the
tag it produced into that line, and a tag pinned by hand before an image exists only makes compose
refuse to start. For a hosted relay also set `SUITE_HOSTED=1` and
`SUITE_LICENCE_PUBLIC_KEY`, generating and signing on a workstation so the private key never reaches
the relay:

```sh
pnpm --filter @suite/collab-server licence generate-keypair --out ./licence-private.pem
pnpm --filter @suite/collab-server licence sign \
  --key ./licence-private.pem --tier hosted --workspaces 25 \
  --document-bytes 5242880 --attachment-bytes 26214400 --days 365 --email customer@example.com
```

`SUITE_HOSTED=1` without a key refuses to boot, since a relay that cannot verify a licence is an
unlimited one. `SUITE_HOSTED=0` is a self-host: no licences, and no quotas unless you set them.

Hosted mode is what turns the paywall on, and it turns it on in two places that have to agree: the
control plane's claim route and the relay's socket join. A deployment with `SUITE_HOSTED=1` on the
control plane but not on the relay has a claim route that refuses and a door that opens, which reads as
"Synced" for an account with no plan. `pnpm dev` sets it for both, so a local run has the deployment's
shape: a fresh account stays local until a plan exists, and `pnpm drill:billing` is how a licence is
written without a payment provider.

`compose.yaml` puts all six stores on the one volume (`documents`, `shares`, `workspaces`, `settings`,
`licences`, `attachments`) and sets `SUITE_REQUIRE_DURABLE_STORES=1`, so boot refuses any store that is
unset, `:memory:`, relative, or outside the volume, naming each offender. Leave the flag unset for a
local run. Every variable is in [reference/environment.md](../reference/environment.md).

Run the preflight first. It reads the `.env` and names the failures that do not stop a boot: a
settings key that makes every panel save answer 503, a Turnstile secret with no site key, a mail
transport that prints verification links to a log nobody reads, a licence key pasted as a PEM file.

```sh
deploy/preflight.sh                       # exit 1 when a blocker is found
```

### Turnstile is two values and one policy

The pair is split on purpose. `SUITE_TURNSTILE_SITE_KEY` is **public** and inlined into the canvas at
build time, so it belongs on the build (`deploy/compose.aws.yaml` passes it, `Dockerfile` inlines it);
changing it means rebuilding the `caddy` image. `SUITE_TURNSTILE_SECRET` is read by the control plane
at runtime and only ever leaves it to Cloudflare, so it belongs in `.env` and a restart picks it up.

Setting the secret makes the challenge **mandatory**: sign-up with no token answers
`400 MISSING_RESPONSE`. That is why the site key has to be in the same deployment, and why the policy
has to allow the widget. `deploy/Caddyfile` permits `challenges.cloudflare.com` in `script-src`,
`connect-src` and `frame-src` on the two canvas hosts. Without those three the script is blocked, no
token is produced, and every sign-up fails forever while the page itself looks perfect (ADR-0077).

```sh
deploy/deploy.sh --no-backup              # builds suite:v0.1.0-alpha.1, starts app, waits for health
docker compose build caddy control-plane  # the other two images, from the same checkout
docker compose up -d --no-build           # Caddy, the control plane and Postgres
docker compose ps && docker compose logs -f caddy     # wait for "certificate obtained successfully"
curl -fsS https://canvas.example.com/health           # {"ok":true}
curl -fsS -o /dev/null -w '%{http_code}\n' https://canvas.example.com/admin
```

Open the canvas, create a workspace, and sign in. There is no recovery key any more: a workspace belongs
to the organization that first opened it, and access is the account's own sign-in. To keep the panel off the public internet, uncomment
the two `remote_ip` lines in `deploy/Caddyfile`, list your office or VPN addresses, and rebuild Caddy.

## 7. Backups and the mount guard

`deploy/backup.sh` snapshots all six stores with SQLite's online backup, checks
`PRAGMA integrity_check`, hashes each file, and writes a manifest with per-table row counts and an
attachment-id checksum. With `SUITE_BACKUP_BUCKET` set it uploads one tarball to S3 or R2.

```sh
sudo apt-get install -y sqlite3
curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o awscliv2.zip
unzip -q awscliv2.zip && sudo ./aws/install && rm -rf aws awscliv2.zip
sudo aws configure --profile suite-backup      # cron runs as root
```

Bucket: versioning on, Block Public Access on, SSE-S3 on, and an IAM user allowed only `s3:PutObject`
on `arn:aws:s3:::suite-backups/suite/*`. The script resolves all six stores from `SUITE_DATA_DIR` and
detects the `documents.sqlite` naming compose uses, so that variable plus the bucket is the whole
configuration.

```sh
sudo install -m 600 /dev/null /etc/suite/backup.env
sudo tee /etc/suite/backup.env >/dev/null <<'EOF'
SUITE_DATA_DIR=/mnt/suite-data
SUITE_BACKUP_BUCKET=s3://suite-backups
SUITE_BACKUP_PREFIX=suite
AWS_PROFILE=suite-backup
AWS_DEFAULT_REGION=eu-west-1
EOF
```

```cron
20 3 * * * root set -a; . /etc/suite/backup.env; set +a; /srv/suite/deploy/backup.sh /srv/backups >> /var/log/suite-backup.log 2>&1
40 3 * * * root find /srv/backups -mindepth 1 -maxdepth 1 -name 'suite-*' -mtime +14 -exec rm -rf {} +
*/15 * * * * root mountpoint -q /mnt/suite-data || logger -t suite 'EBS data volume is NOT mounted'
*/5 * * * * root /srv/suite/deploy/alert.sh --url http://127.0.0.1:1235 >/dev/null
```

Retention (7 daily and 4 weekly copies) belongs to the bucket lifecycle, and the rule plus the restore
caveats are in [operate.md](operate.md). Snapshots are unencrypted: plaintext content, uploaded images,
share and owner hashes. The bucket is encrypted at rest and the directory is root-only. Keep
`/srv/backups` off the data volume, or a volume loss takes the backups with it.

## 8. Restore drill

Monthly, read-only, because a backup you have never verified is a hope:

```sh
/srv/suite/deploy/restore.sh "$(ls -d /srv/backups/suite-*/ | tail -1)" --verify-only
/srv/suite/deploy/restore.sh /srv/backups/suite-20261023T001541Z --force   # quarterly, full drill
```

In order: verify, refuse a non-empty volume without `--force`, stop `app`, delete the six files and
their stale `-wal`/`-shm` sidecars, copy the snapshot in, start `app`, and require `/health` within 90 seconds. Check the workspace you know best and one share link, then record the duration, which is your RTO.
Caddy keeps proxying while `app` is down, so visitors see 502 for the length of the copy.

## 9. Upgrade by building on the host

Nothing is pulled: the host builds `app` from `/srv/suite`, which is why it needs 4 GB of memory and
30 GB of root disk (§1) and why a Graviton host produces an arm64 image. Neither the steps below nor
`deploy/deploy.sh` depends on `.github/workflows/ci.yml` or `release.yml`, which cannot run on this
account.

The order is the part that matters. A host build replaces the image it runs, so the image that is
running now is tagged *before* the build starts; that tag is the whole rollback.

1. **Snapshot the six stores.** A release that changes a stored format can only be undone from a
   backup taken before it opened the stores.

   ```sh
   cd /srv/suite
   sudo bash -c 'set -a; . /etc/suite/backup.env; set +a; /srv/suite/deploy/backup.sh /srv/backups'
   ```

2. **Ask the running container which version it is.** The answer names the rollback tag; `v0.1.0-alpha.1`
   below stands for it.

   ```sh
   docker compose ps -q app | xargs docker inspect \
     --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^SUITE_VERSION=//p'
   ```

3. **Tag the running image before anything can replace it.**

   ```sh
   docker tag "$(docker compose images -q app)" suite:rollback-v0.1.0-alpha.1
   ```

   `docker compose images -q app` prints the image id the container runs from, so the tag names that
   exact image and keeps it after the build moves `suite:local`.

4. **Move the checkout onto the release.** The build reads the working tree, not a tag.

   ```sh
   git fetch --tags && git checkout v1.1.1 && git describe --tags --exact-match
   ```

5. **Build the image with the tag baked in.** `SUITE_VERSION` is what `/metrics` and
   `/api/admin/status` report. Both `-t` flags matter: `suite:v1.1.1` is the record you can come back
   to, `suite:local` is what compose runs when `.env` names no image.

   ```sh
   docker build --target runtime --build-arg SUITE_VERSION=v1.1.1 \
     -t suite:v1.1.1 -t suite:local .
   ```

6. **Pin the tag and restart `app` alone.**

   ```sh
   sed -i -E 's|^#?[[:space:]]*SUITE_IMAGE=.*|SUITE_IMAGE=suite:v1.1.1|' .env
   docker compose up -d --no-build app     # Caddy keeps running; 502 for the restart only
   ```

   `--no-build` because the image already exists: without it compose may rebuild and retag over the
   tag being started.

7. **Check the version, not only health.**

   ```sh
   curl -fsS https://canvas.example.com/health
   # The operator API answers a session: sign in at /admin.html and use its token,
   # or read /api/admin/status from the box while SUITE_METRICS_LOCAL is on.
   curl -fsS http://127.0.0.1:1235/metrics | grep suite_build_info
   ```

   A container that reports the previous version is still the previous release, however healthy
   `/health` looks.

`deploy/deploy.sh` runs this sequence: it backs up, tags the running image, builds `suite:<tag>` and
`suite:local` from the tag at `HEAD`, writes `SUITE_IMAGE` into `.env`, restarts `app` with
`--no-build`, and waits 90 seconds for the compose healthcheck. A failure leaves the old image tagged
and prints the rollback command.

```sh
cd /srv/suite && git fetch --tags && git checkout v1.1.1 && deploy/deploy.sh
```

A host that writes its logs to CloudWatch carries a second compose file, and every `docker compose`
command on that host has to name it. Put it in `.env` once, and `docker compose` and `deploy/deploy.sh`
both read it from there:

```sh
# .env
COMPOSE_FILE=compose.yaml:deploy/compose.aws.yaml
```

`app` is the only image `deploy/deploy.sh` builds, because it is the only one that changes every
release. When the control plane changed too, rebuild it and include it in the restart:

```sh
docker compose build control-plane
docker compose up -d --no-build app control-plane
```

### Tabs that outlive a deploy

A canvas tab keeps running the bundle it loaded. `index.html` is `no-store` and the hashed chunks under
`/assets` are immutable, so nothing about the deploy reaches a tab that is already open: the old engine
keeps running, and a fix that shipped reads as a bug that survived it. Ask the reader to reload before
believing a report against a tab that predates the build.

`apps/canvas/src/app/useStaleBuild.ts` makes that visible instead of remembered. It compares the entry
chunk this page loaded with the one the server would hand out now, on mount and whenever the tab comes
back into view, and `StaleBuildNotice.tsx` shows a line with a Reload button when they differ. It never
reloads on its own: a document can be mid-edit.

### Rollback

Rollback restarts on the tag taken in step 3. Nothing is compiled and no old checkout is involved, so
it takes as long as a container recreate.

```sh
deploy/deploy.sh --rollback suite:rollback-v0.1.0-alpha.1

# the same thing by hand
sed -i -E 's|^#?[[:space:]]*SUITE_IMAGE=.*|SUITE_IMAGE=suite:rollback-v0.1.0-alpha.1|' .env
docker compose up -d --no-build app
```

`deploy/deploy.sh --list` prints the tags this host holds. Keep the last two `suite:rollback-*` and
remove older ones with `docker image rm`: each is a full copy of the image and counts against the root
volume.

The tag returns the code; the data moves with it only as far as the schema allows. Stores migrate
forward when opened, so a release that bumped `PRAGMA user_version` or changed a snapshot tag is undone
by restoring the step 1 snapshot with `deploy/restore.sh --force` ([operate.md](operate.md)), then
starting the older tag. [release.md](release.md) has the rest of that procedure.

### What the build needs

The build runs on the same box that serves, so these are facts about the deployment.

- **4 GB of memory, or swap on 2 GB.** `pnpm build` for the canvas and the Docker build that runs the
  same tree inside `node:22-bookworm` each want roughly 1 GB, and the second one runs inside a
  container whose memory is charged to the same box. On 2 GB (`t4g.small`, the $5 Lightsail plan) one
  of them usually ends in `JavaScript heap out of memory` or a killed `vite`, mid-upgrade, with the
  rollback tag already taken and `app` still on the old image. For 4 GB of swap:

  ```sh
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

  A swap-backed build takes several minutes. Resizing to `t4g.medium` for the upgrade is faster, and
  is what §1 recommends past a handful of workspaces.

- **About 30 GB of root volume.** The checkout grows with history, `node_modules` and the pnpm store
  are several GB, and every image adds layers on top of the `node:22-bookworm` base. Reclaim space
  before the build:

  ```sh
  df -h /                          # the number that decides whether to build now
  docker builder prune             # build cache, 5-10 GB after a few upgrades
  pnpm store prune                 # store entries no current lockfile names
  docker image prune               # dangling layers; --all also drops tags, so check --list first
  ```

  The builder cache is the one that surprises people: it keeps the intermediate layer of every stage
  of every build, and on a 30 GB disk two or three upgrades fill it. `deploy/deploy.sh --prune` runs
  the first two for you.

- **Architecture follows the host.** The image is built for the machine doing the building: arm64 on
  Graviton, x86-64 on Intel. That is correct here because the host builds what it serves. An image
  moved from an x86 workstation with `docker save` and `docker load`, or pulled from a registry that
  built it elsewhere, starts and then dies with `exec format error`. A build that has to happen
  off-instance needs `--platform linux/arm64` and a builder of that architecture.

### Which image a change needs

Three images serve the deployment and each one carries a different part of the tree, so a change that
touches more than one needs more than one build:

| Change | Image | Rebuild |
| --- | --- | --- |
| `apps/canvas`, `apps/docs`, `apps/site`, `deploy/Caddyfile` | `suite-caddy` | `docker compose build caddy` |
| `apps/control-plane`, `services/auth`, `services/billing` | `suite:local-control-plane` | `docker compose build control-plane` |
| `apps/collab-server` (the relay) | `suite:local` | `deploy/deploy.sh` |

A single-service build leaves the others running the code from whenever they were last built. That
does not fail: the process is healthy, the old routes answer, and a request for a route added since
reads as **404 `not_found`** from the control plane's host, which looks like a missing feature rather
than a missing build. When in doubt, build all three from the same checkout:

```sh
git pull --ff-only
docker compose build app control-plane caddy
docker compose up -d --no-build
```

`docker compose ps` shows how long each container has been up, and `docker images` shows when each
image was built. A control-plane container older than the commit that added the route it is missing is
the whole diagnosis.

### A Caddyfile change

A `deploy/Caddyfile` change needs `docker compose build caddy && docker compose up -d caddy`, which
costs a couple of seconds of 502. Enable the commented `caddy-data` volume if you recreate Caddy often,
or it re-issues certificates until Let's Encrypt's five-per-week limit stops you.

### When the certificate authority says no

The limit is real and it is measured per exact hostname set: five duplicate certificates in seven days,
then `429 rateLimited` until the window rolls over, which is days away and not shortened by asking
sooner. Caddy logged this and kept retrying while every host answered nothing, so the shape of the
incident was a working origin with no TLS.

The fix is a second authority rather than a wait. `SUITE_ACME_CA` selects the directory:

```sh
# .env on the host, then `docker compose build caddy && docker compose up -d caddy`
SUITE_ACME_CA=https://acme.zerossl.com/v2/DV90
SUITE_ACME_EMAIL=you@example.com     # ZeroSSL mints account credentials from the address
```

ZeroSSL hands Caddy its EAB credentials when an email is set, so nothing has to be registered by hand;
the certificate is a normal 90-day DV certificate and the ACME account lives in `caddy-data` beside the
Let's Encrypt one. `deploy/Caddyfile` defaults to Let's Encrypt, so this is a line in `.env`, not a
change to the file. Two authorities side by side also mean a future rate limit costs one variable
instead of an outage.

The other half of the incident was ours: `caddy` had its state on `tmpfs`, so every recreate began with
an empty `/data` and requested three fresh certificates. `deploy/compose.aws.yaml` mounts the
`caddy-data` volume, and without it a handful of deploys in one afternoon spends the weekly allowance.

### Publishing to a registry again (optional)

Not used today, and nothing above needs it. If a registry becomes available, GitHub Actions on a
working account or Codeberg with a container registry, only step 5 changes: build with a registry
tag, push it, and point `SUITE_IMAGE` at the digest it produced. `compose.yaml` accepts any reference
in `SUITE_IMAGE`, so a pull-based host sets it to `ghcr.io/<owner>/suite@sha256:…` and then runs
`docker compose pull app` followed by `docker compose up -d --no-build app`. A host that builds keeps
using `suite:<tag>`, and `caddy` is never pulled because it packages this checkout's canvas bundle.

## Container hardening

`compose.yaml` runs every service with the smallest surface it can and still work. The two server
processes are the strict case, because they are the ones exposed to a document and to the internet:

| Control | `app` | `control-plane` | `caddy` |
| --- | --- | --- | --- |
| User | `1000:1000` (`node`, set by the image) | same | root, with one capability |
| Root filesystem | `read_only: true` | `read_only: true` | `read_only: true` |
| Writable paths | the `suite-data` volume at `/data`, `tmpfs` on `/tmp` | `tmpfs` on `/tmp` | `tmpfs` on `/tmp`, `/config`, `/data` |
| Capabilities | `cap_drop: ALL` | `cap_drop: ALL` | `cap_drop: ALL`, `cap_add: NET_BIND_SERVICE` |
| Escalation | `no-new-privileges:true` | same | same |
| Limits | `mem_limit: 1536m`, `cpus: "1.0"`, `pids_limit: 256` | `512m`, `0.5`, `128` | `256m`, `0.5`, `128` |

The relay never needed a writable root: its six stores are on the volume, and the `tmpfs` on `/tmp` is
there because Node and `tsx` want a scratch directory. Caddy is the exception on two counts — ports 80
and 443 need `NET_BIND_SERVICE`, and its certificate cache would be tmpfs unless the commented
`caddy-data` volume is enabled, in which case a certificate survives a recreate.

Prove it rather than read it. The relay, with every store on the volume and a read-only root:

```sh
docker build --target runtime -t suite-relay .
docker run --rm -d --name suite-relay-probe \
  --read-only --tmpfs /tmp:size=32m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges --user 1000:1000 \
  -v suite-probe-data:/data \
  -e PORT=1234 -e HEALTH_PORT=1235 \
  -e SUITE_DB=/data/documents.sqlite -e SUITE_SHARES_DB=/data/shares.sqlite \
  -e SUITE_WORKSPACES_DB=/data/workspaces.sqlite -e SUITE_SETTINGS_DB=/data/settings.sqlite \
  -e SUITE_LICENCE_DB=/data/licences.sqlite -e SUITE_ATTACHMENTS_DB=/data/attachments.sqlite \
  -e SUITE_REQUIRE_DURABLE_STORES=1 suite-relay
docker exec suite-relay-probe node -e "fetch('http://127.0.0.1:1235/health').then(async r=>console.log(r.status, await r.text()))"
# 200 {"ok":true}
docker exec suite-relay-probe id
# uid=1000(node) gid=1000(node) groups=1000(node)
```

The control plane needs Postgres, because it refuses to boot without a database URL:

```sh
docker build --target control-plane -t suite-control-plane .
docker run --rm -d --name suite-pg -e POSTGRES_USER=suite -e POSTGRES_PASSWORD=suite -e POSTGRES_DB=suite postgres:17-alpine
docker run --rm -d --name suite-cp-probe --read-only --tmpfs /tmp:size=32m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges --user 1000:1000 \
  -e PORT=1236 -e SUITE_CONTROL_PLANE_DATABASE_URL=postgres://suite:suite@<postgres-host>:5432/suite \
  -e SUITE_AUTH_ENABLED=0 -e SUITE_BILLING_ENABLED=0 suite-control-plane
docker exec suite-cp-probe node -e "fetch('http://127.0.0.1:1236/health').then(async r=>console.log(r.status, await r.text()))"
# 200 {"status":"ok",…,"checks":[{"name":"database","state":"ok"}]}
```

And that the runtime tree carries no toolchain:

```sh
docker run --rm suite-relay sh -c 'ls node_modules/.pnpm | grep -E "^(typescript|vitest|@biomejs|@stryker|turbo)@" || echo clean'
# clean
```

## The account service on a hosted launch

The relay above is one process on one box. The account service is the part that needs a managed
database, because it holds accounts, organizations, seats and subscriptions, and losing it means every
sign-in stops. Put it on RDS Postgres and leave the documents on the box.

```
app.suite.run ──▶ Caddy ──┬──▶ control-plane:1236  /api/auth, /api/account, /admin/admissions
                          ├──▶ app:1235            /api/workspaces, /health, /metrics
                          └──▶ app:1234            /ws
                                   │
                          RDS Postgres (accounts, organizations, billing)
                          EBS volume   (six SQLite stores)
```

Creating that database, the fields that matter:

| Field | Value | Why |
| --- | --- | --- |
| Engine | Postgres 17 | the migrations are tested against it, and `pnpm db:verify` names the version if a host drifts |
| Template | Free tier, `db.t4g.micro`, 20 GB gp3 | accounts and subscriptions are small; the documents are not here |
| Connectivity | same VPC, private subnets, no public access | only the instance's security group needs 5432, added as an inbound rule on the database's group |
| Encryption | on, at creation | it cannot be turned on afterwards |
| Backup | as long as the plan allows; deletion protection | a lost accounts table is a lost deployment. A FREE-plan account caps automated retention at 1 day and refuses 7 with `FreeTierRestrictionError`, which is exactly why `deploy/backup.sh` writes its own `pg_dump` to S3 |
| Parameters | `rds.force_ssl = 1` | the connection string carries `sslmode=require`, and this makes it enforced |

Nothing migrates by hand. The control plane runs its migrations on the first request that needs
identity, so a fresh database fills itself in and a failed migration clears the memo and retries
rather than wedging the process. `pnpm db:verify` (or `scripts/db-verify.mjs` on the host) is the check
that the eleven migrations landed.

Two things RDS does not do for you, both of which fail in ways that look like something else:

1. **The database itself.** RDS creates `postgres` and nothing else, so a connection string ending
   `/suite` answers `database "suite" does not exist`, and only after the certificate verifies, so
   the message changes as you fix each layer.

   ```sh
   docker run --rm postgres:17-alpine \
     psql "postgres://suite:PASS@HOST:5432/postgres?sslmode=require" -c 'CREATE DATABASE suite'
   ```

2. **The certificate.** `sslmode=require` currently means `verify-full`, and RDS signs its endpoint
   with a CA no Node image carries: the control plane answers
   `503 checks:[{name:"database",state:"failed",detail:"self-signed certificate in certificate chain"}]`.
   `sudo deploy/rds-ca.sh` fetches the public bundle, and `deploy/compose.aws.yaml` mounts it and
   points `NODE_EXTRA_CA_CERTS` at it. Do not "fix" this with
   `uselibpqcompat=true&sslmode=require`, which encrypts without verifying anything.

Set `app.suite.run` to **DNS only** in Cloudflare. The proxy's idle timeout sits on a WebSocket that is
supposed to stay open, and a collaboration socket behind it is dropped on a timer.

Four variables decide whether a person who signs up can ever get in:

| Variable | Why it has to be right |
| --- | --- |
| `SUITE_CONTROL_PLANE_DATABASE_URL` | Compose defaults it to the `postgres` service, which does not exist on a host that uses RDS: the name resolves to nothing and the control plane boots degraded. Point it at the server with `?sslmode=require`. |
| `SUITE_AUTH_SECRET` | Signs the session. Changing it signs everyone out. |
| `SUITE_MAIL_TRANSPORT` | `console` cannot deliver a verification link. Use `resend` with `RESEND_API_KEY` and `SUITE_MAIL_FROM`, or `smtp` with `SUITE_SMTP_URL`. |
| `SUITE_ADMISSION_REQUIRED` | `1` holds every new account. Pair it with `SUITE_ADMIN_EMAILS` or the boot refuses: the queue would have no door. |
| `STRIPE_WEBHOOK_SECRET` | Without it every delivery fails verification, so no payment is recorded. `pnpm stripe --listen` prints it locally; on the host it comes from the Stripe dashboard endpoint. |
| `SUITE_AUTH_JWKS_URL` | The address the relay *fetches* the key set from, when that is not the public origin. Compose defaults it to `http://control-plane:1236/api/auth/jwks`; leave it set, or the relay asks the proxy for its own public hostname and no session verifies. |
| `SUITE_ADMIN_EMAILS` | Who may use the operator surface. Comma-separated, matched against the signed-in address. Unset locks the admissions queue and the starter list to nobody. |

**Name the first operator before the first boot.** `SUITE_ADMIN_EMAILS` is the only door to the
admissions queue and the starter list, and an account becomes an operator by *address*, so create the
account first and add its address to the variable:

```sh
# 1. the address is in .env, then restart the control plane so it is read
SUITE_ADMIN_EMAILS=you@example.com
# 2. sign up once at https://app.suite.run, follow the confirmation mail
# 3. sign in at https://app.suite.run/admin.html; the panel says whether you are an operator
```

If step 3 answers "not an operator", the variable did not reach the process: it is read through a
whitelist (`services/auth/src/http/env.ts`), and a missing value there mints `operator: false` rather
than refusing to boot.

Admitting the first users, once mail and the queue are live: sign in at
`https://app.suite.run/admin.html` with an address from `SUITE_ADMIN_EMAILS` and use the
Admissions tab. The same list opens `/admin/templates` for writing and the relay's
`/api/admin/*`. The account API needs the queue and starter list, which
`deploy/Caddyfile` already routes to the control plane on the app origin, and it routes
`/admin/settings`, `/admin/accounts`, `/api/account*` and `/api/invites/*` the same way:
those are control-plane paths that the `/admin` panel rewrite and the `/api/*` relay
default would otherwise answer with a page or a 404.

An address that is not on the list gets `403 forbidden` and a sentence saying so, which
is the honest answer rather than a lockout: the panel tells the reader their address
needs adding.

**A new account cannot sync until it subscribes.** Local and offline use is free and needs no
account; an account is what buys sync, so the born-with licence grants no workspace and
`POST /api/workspaces/claim` answers `402 plan-required` until a subscription replaces the
row. The app shows the plan picker rather than a bare refusal. Testers skip payment with a
100%-off promotion code at checkout, which keeps them on the real paid path.

## Support access and impersonation

The Accounts tab opens a support session: the operator becomes the account, sees what it
sees, and stops when they are done. It is gated on consent the account itself gave, not on
the operator's role.

| Fact | Where it lives |
| --- | --- |
| Who may start one | `SUITE_ADMIN_EMAILS`, read per request |
| Whether it exists at all | the `flags.impersonation` settings row, on by default |
| Consent | the `operator_support_grants` table, written from the account's own session |
| The second factor | required: the admin plugin refuses an impersonation for an account without 2FA |

An operator needs a second factor of their own before impersonating: the admin plugin
refuses an account that can manage people without one, and the Accounts tab enrols it: the
password, then the `otpauth://` URI into an authenticator, then one code. That is a
condition of the role, not of the panel, so it holds however the request arrives.

The account turns consent on from **Support access…** in the app's File menu, and can turn
it off there without asking anyone. The operator sees the grant in the Accounts list and
may only *end* it; a request that tries to grant it is refused with `consent-is-the-accounts`,
because a permission the operator can give themselves is not consent.

Turning the flag off is the deployment-wide switch: set `flags.impersonation` to off in
Settings and every impersonation request answers 403, grant or no grant, without a restart.

Every impersonation also writes two rows and leaves one for the account: an
`operator_audit` entry (who, when, and what came of it) and an `account_notices` sentence the
account reads at its next sign-in. Neither names a secret, and the notice deliberately does
not name the operator.

### Tables the control plane creates

Four tables appear on first use rather than in a migration, so an older database boots:

| Table | Written by | Read by |
| --- | --- | --- |
| `suite_settings` | Settings | every process's boot overlay, and the panel |
| `operator_support_grants` | the account, or an operator ending one | the impersonation gate |
| `operator_role_overrides` | an operator wearing a role | the memberships reader, so the session and the relay's token agree |
| `operator_audit` | every operator act | the Activity tab |
| `account_notices` | an impersonation | the account's own dialog and strip |

All five live in Postgres, so `deploy/backup.sh` covers them with the `pg_dump` it already
takes. None has a retention policy: audit rows are kept forever, which is stated rather than
assumed.

`SUITE_APP_URL` is where the admission notice sends someone. Unset admits without sending one.

A held account is not broken: it can sign in, edit, import and export on its own device. What it cannot
do is create an organization or open a sync connection, which is what "waiting for approval" means.

## Docs and marketing

`docs.suite.run` is the static Astro tree described below. The marketing site is a second static build
with no server, so both belong on Cloudflare Pages rather than on the box: a page that is a file does
not need a machine that can go down.

Pages builds nothing. The directory is built here, by the same command the gate runs, and uploaded,
so Cloudflare never has to reproduce the workspace, the pnpm version or the Node version. A page that
renders on Pages but not locally is a difference nobody can debug.

```sh
pnpm deploy:docs     # pnpm docs:site:build, then upload to the suite-docs project
pnpm deploy:site     # pnpm site:build, then upload to the suite-site project
```

Both scripts take `--no-build` when the tree in `apps/*/dist` is already what should ship. Each uploads
to the project's production environment, so the custom domain picks the deploy up; without the branch
flag an upload is a preview and the domain keeps serving the old tree.

The credential is not in the repository, and it is one of two:

| Credential | How the scripts get it | When it is right |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` plus `CLOUDFLARE_ACCOUNT_ID` | read from the environment, so a CI job or a shell with both set works unattended | anything repeatable |
| `wrangler login` | an OAuth session in `~/.wrangler`, which the scripts pick up when neither variable is set | a person deploying from their own machine |

The token needs **Cloudflare Pages: Edit** on the account, and **Zone: DNS: Edit** on `suite.run` only
if the custom domains are being attached with the API rather than clicked in the dashboard.

Then add the custom domains in each Pages project: `docs.suite.run` on `suite-docs`, and `suite.run` on
`suite-site`. Leave those records proxied, because unlike the app a static origin has no long-lived
socket for the proxy's idle timeout to cut. `app.suite.run` stays on the box and is not touched: it
serves the canvas, the relay's socket and the control plane, none of which is a file.

| Host | Serves | Where it is built |
| --- | --- | --- |
| `app.suite.run` | canvas, relay, control plane | the box, `docker compose` |
| `docs.suite.run` | `docs/` as a Starlight site | `apps/docs/dist`, uploaded by `pnpm deploy:docs` |
| `suite.run` | the marketing page | `apps/site/dist`, uploaded by `pnpm deploy:site` |

`_headers` in each site's `public/` directory is the Cloudflare equivalent of the Caddy policy, and it
is copied into `dist` at build time. Keep the two in step: the same page should not have a different
security posture depending on whether it was served from Pages or from the box. The docs site allows
inline scripts because Starlight emits them; the marketing page does not need to.

## Docs site

The reader-facing docs are a static Astro site in `apps/docs`, built from `docs/`. It needs no
database, no volume and no relay: the image is the built tree at `/srv/docs`, which is the default of
`SUITE_DOCS_ROOT` in `deploy/Caddyfile` and the root the `docs.suite.run` site block serves.

```sh
docker compose --profile docs up -d --build docs
curl -fsS http://127.0.0.1:3001/ > /dev/null
curl -fsS http://127.0.0.1:3001/llms.txt > /dev/null
```

The image reads the Markdown at build time, so a docs edit needs a rebuild. The container serves that
tree with Caddy's file server on port 3001. The same build runs locally with `pnpm docs:site:build` and
`pnpm docs:site:start`.

The marketing page is the same shape in `apps/site`: `/srv/marketing`, `SUITE_MARKETING_ROOT`, and
`pnpm site:build`.

Starlight ships inline scripts for the theme, the search dialog and the sidebar, and the dashboard adds
one for its tabs and filter. The docs host therefore carries `script-src 'self' 'unsafe-inline'`, and
it is the only host that does: there is no user content on that origin, which is what makes the
relaxation safe there and nowhere else. The marketing page has no scripts and keeps `'self'`.

## What not to do

- A second `app` replica, through `--scale app=2`, an autoscaling group or a load balancer, corrupts the
  locking assumptions: two processes on one volume, or two volumes behind one hostname that silently
  split workspaces.
- SQLite on a network filesystem, or one EBS volume Multi-Attached to two instances, breaks locking and
  WAL shared memory.
- `docker compose down -v` removes the volume, and instance-store or spot-only data does not survive a
  replacement.
- `/metrics` and `/admin` stay off the public internet. The token is all-or-nothing, so allowlist or
  tunnel it.
- One Caddy container, and nothing else serving `/srv`. The caching and `no-store` headers live in
  `deploy/Caddyfile`.

## Cost

List prices, one small instance, excluding tax. Check them before quoting.

| Item | Monthly |
| --- | --- |
| Lightsail 2 GB (1 vCPU, 60 GB SSD, 3 TB transfer) | ~$12 |
| EC2 `t4g.small` with 20 GB gp3 and a public IPv4 | ~$17 |
| 4 GB step (`t4g.medium`) | ~$24–30 |
| EBS snapshots and S3 backups (5 GB) | ~$1–2 |
| Cloudflare Free (proxy, TLS, one WAF rule) | $0 |

The cost that bites is not on the table: a root volume filling with images, logs and local snapshots,
or a box swapping because one board share rebuilds every few seconds on one core. Ten instances with
ten separate workspace sets is the only scale shape, and it costs ten times one.
