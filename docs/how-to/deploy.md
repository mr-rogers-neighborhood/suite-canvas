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

## 2. Create the instance and install Docker

Lightsail: Ubuntu 24.04, 2 GB, static IP attached. EC2: Ubuntu 24.04 LTS, `t4g.small`, Elastic IP,
security group from step 4. Instance store is not durable; root EBS is.

```sh
sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg git sqlite3
curl -fsSL https://get.docker.com | sudo sh          # Docker's own repo, not the distro package
sudo usermod -aG docker "$USER"                     # log out and back in

sudo mkdir -p /srv && sudo chown "$USER" /srv
git clone https://github.com/mr-rogers-neighborhood/suite /srv/suite
```

The host needs the checkout because the `caddy` service is built from it and bakes `deploy/Caddyfile`
and the canvas bundle into the image. The `app` image itself is pulled.

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
  -fsS -H "authorization: Bearer $SUITE_ADMIN_TOKEN" http://127.0.0.1:1235/metrics | head
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
  rate-limit bucket.

An external monitor on `https://canvas.example.com/health`, expecting `200 {"ok":true}`, catches the
instance being down; `deploy/alert.sh` from cron catches it being sick.

## 6. First boot

```sh
cd /srv/suite && cp .env.example .env && chmod 600 .env
openssl rand -base64 32     # SUITE_ADMIN_TOKEN, the root credential
openssl rand -base64 32     # SUITE_PROJECTION_TOKEN
openssl rand -base64 32     # SUITE_SOURCE_TOKEN
```

Set `SUITE_DOMAIN`, `SUITE_ACME_EMAIL`, and `SUITE_IMAGE=ghcr.io/<owner>/suite:v1.0.0`. Pin a
release, because `:latest` moves under you. For a hosted relay also set `SUITE_HOSTED=1` and
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

`compose.yaml` puts all six stores on the one volume (`documents`, `shares`, `workspaces`, `settings`,
`licences`, `attachments`) and sets `SUITE_REQUIRE_DURABLE_STORES=1`, so boot refuses any store that is
unset, `:memory:`, relative, or outside the volume, naming each offender. Leave the flag unset for a
local run. Every variable is in [reference/environment.md](../reference/environment.md).

```sh
docker compose pull app && docker compose up -d --build
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
*/5 * * * * root SUITE_ADMIN_TOKEN=<token> /srv/suite/deploy/alert.sh --url https://canvas.example.com >/dev/null
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

## 9. Upgrade by image tag

```sh
cd /srv/suite
sudo bash -c 'set -a; . /etc/suite/backup.env; set +a; /srv/suite/deploy/backup.sh /srv/backups'
$EDITOR .env                      # SUITE_IMAGE=ghcr.io/<owner>/suite:v1.0.0
docker compose pull app && docker compose up -d app     # Caddy keeps running
curl -fsS https://canvas.example.com/health
```

The tag travels into the process as `SUITE_VERSION`, visible in `/metrics`, `/api/admin/status` and the
`server ready` line.

Rollback is the previous tag and the same two commands, unless the release changed a stored format.
Stores migrate forward on open, so a rollback after a schema change is a restore, not a tag change;
that is what the pre-upgrade backup is for. See [release.md](release.md).

A `deploy/Caddyfile` change needs `docker compose build caddy && docker compose up -d caddy`, which
costs a couple of seconds of 502. Enable the commented `caddy-data` volume if you recreate Caddy often,
or it re-issues certificates until Let's Encrypt's five-per-week limit stops you.

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
# 200 {"status":"ok","buildId":"0.0.0","uptimeMs":8744,"modules":[{"name":"auth","state":"mounted"},{"name":"billing","state":"mounted"},{"name":"admin","state":"mounted"}]}
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

Set `app.suite.run` to **DNS only** in Cloudflare. The proxy's idle timeout sits on a WebSocket that is
supposed to stay open, and a collaboration socket behind it is dropped on a timer.

Four variables decide whether a person who signs up can ever get in:

| Variable | Why it has to be right |
| --- | --- |
| `SUITE_AUTH_SECRET` | Signs the session. Changing it signs everyone out. |
| `SUITE_MAIL_TRANSPORT` | `console` cannot deliver a verification link. Use `resend` with `RESEND_API_KEY` and `SUITE_MAIL_FROM`, or `smtp` with `SUITE_SMTP_URL`. |
| `SUITE_ADMISSION_REQUIRED` | `1` holds every new account. Pair it with `SUITE_ADMIN_TOKEN` (16+ characters) or the boot refuses: the queue would have no door. |
| `STRIPE_WEBHOOK_SECRET` | Without it every delivery fails verification, so no payment is recorded. `pnpm stripe --listen` prints it locally; on the host it comes from the Stripe dashboard endpoint. |

Admitting the first users, once mail and the queue are live:

```sh
curl -fsS "$SUITE_AUTH_URL/admin/admissions" \
  -H "authorization: Bearer $SUITE_ADMIN_TOKEN"          # who is waiting
curl -fsS -X POST "$SUITE_AUTH_URL/admin/admissions" \
  -H "authorization: Bearer $SUITE_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"emails":["them@example.com"]}'                   # admit, and tell them
```

`SUITE_APP_URL` is where the admission notice sends someone. Unset admits without sending one.

A held account is not broken: it can sign in, edit, import and export on its own device. What it cannot
do is create an organization or open a sync connection, which is what "waiting for approval" means.

## Docs and marketing

`docs.suite.run` is the static Astro tree described below. The marketing site is a second static build
with no server, so both belong on Cloudflare Pages rather than on the box: a page that is a file does
not need a machine that can go down.

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
