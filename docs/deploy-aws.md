# Deploy to AWS

One small instance, one Docker host, one `app` container, six SQLite stores on one EBS volume,
Caddy in front, Cloudflare in front of Caddy. That is the whole architecture; this runbook takes a
fresh AWS account to a running, monitored, backed-up deployment and says where the sharp edges are.

What this is not: there is no second replica, no shared database and no zero-downtime deploy. Rooms,
presence, projection state and rate-limit counters live in the `app` process, and SQLite is a local
file. Scale comes from **another instance with its own workspaces**, never from replicas of this one
(see [What not to do](#what-not-to-do)).

```
visitor ──▶ Cloudflare (proxy, WAF, cache bypass) ──▶ :443 Caddy ──▶ app:1235 /api, /health, /metrics
                                                          └──────▶ app:1234 /ws
                                                                     │
                                                              /data = EBS volume
                                    documents / shares / workspaces / settings / licences / attachments
```

Everything below assumes the repository at `/srv/suite`, the compose project name `suite` (set in
`compose.yaml`), and `canvas.example.com` as the public hostname. Substitute your own.

## 1. Pick a size

The process is one Node server holding every open room in memory, plus Caddy. The expensive
operations are loading a room and rebuilding a share projection (a 5 000-card board takes seconds
per rebuild per link — see the capacity table in
[operations.md](./operations.md#capacity-what-a-projection-costs)).

| Instance | Comfortable load | Why |
| --- | --- | --- |
| **1 vCPU / 2 GB** — Lightsail 2 GB (~$12/mo) or `t4g.small`/`t3.small` | A handful of workspaces, up to ~10 people editing at once, board shares of ordinary size | ~1 GB is left for rooms after the OS and Caddy; a room is only resident while someone is connected. Fine while `suite_rss_bytes` stays under ~1.2 GB. |
| **2 vCPU / 4 GB** — `t4g.medium`/`t3.medium` | Dozens of concurrent editors, thousands of stored workspaces, frequent whole-board shares | Projection rebuilds are CPU-bound and hold the event loop; a second core absorbs them while edits keep syncing. 4 GB holds more live rooms without swapping. |
| **4 vCPU / 8 GB** — `t4g.large`/`t3.large` | Hundreds of stored workspaces or heavy board-share use | Still one process: more cores help rebuilds, more memory holds more rooms. Past this, split workspaces across instances instead of growing the box. |

Measure rather than guess: `/api/admin/status` reports database sizes, open rooms and connected
clients; `/metrics` has `suite_rss_bytes`, `suite_open_rooms` and
`suite_projection_rebuilds_total`. An instance that spends its day swapping is worse than a bigger
one, and `mem_limit` in `compose.yaml` (commented example) turns a memory leak into a container
restart instead of an OOM kill of the whole box.

**EBS sizing.** gp3, 20 GB is the practical minimum and is plenty for a few hundred workspaces: the
document store is the bulk (snapshots compress poorly, so do not go smaller). Enable **encryption**
at creation — there is no encryption at rest in the application. Grow it later with
`growpart`/`resize2fs`. Local snapshots belong on the root volume under `/srv/backups` (pruned) or,
better, in the bucket; they are not part of `/data`.

## 2. Create the instance

1. **Lightsail:** create a Linux/Ubuntu 24.04 instance with the 2 GB plan, and attach a **static
   IP** (an instance IP changes on stop/start otherwise).
   **EC2:** Ubuntu 24.04 LTS, `t4g.small` (arm64) or `t3.small`, an **Elastic IP**, and a security
   group from step 4. Instance store is not durable; root EBS is.
2. SSH in and install Docker from Docker's repository (not the distro package, which lags):

   ```sh
   sudo apt-get update
   sudo apt-get install -y ca-certificates curl gnupg git sqlite3
   sudo install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg |
     sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
     https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
     sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
   sudo apt-get update
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
   sudo usermod -aG docker "$USER"   # log out and back in
   ```

3. Get the code. The `caddy` service is **built** from the checkout (it bakes `deploy/Caddyfile`
   and the canvas bundle into the image), so the host needs the repository even though the `app`
   image itself can be pulled:

   ```sh
   sudo mkdir -p /srv && sudo chown "$USER" /srv
   git clone https://github.com/mr-rogers-neighborhood/suite /srv/suite
   cd /srv/suite
   ```

## 3. Attach the data volume and mount it at `/data`

Create a gp3 EBS volume in the same availability zone (20 GB, encrypted) and attach it. On Nitro
instances it appears as `/dev/nvme1n1`; confirm with `lsblk`.

```sh
lsblk                              # find the empty disk, e.g. nvme1n1
sudo file -s /dev/nvme1n1          # "data" = unformatted, safe to mkfs
sudo mkfs.ext4 /dev/nvme1n1
sudo mkdir -p /mnt/suite-data
sudo blkid /dev/nvme1n1            # copy the UUID
```

Add one fstab line (UUID from above):

```
UUID=0f0e… /mnt/suite-data ext4 defaults,nofail,x-systemd.device-timeout=10s 0 2
```

```sh
sudo mount -a && mountpoint /mnt/suite-data
```

**Why `nofail` matters, and its trap.** Without it, a transient attach delay leaves the instance
unreachable over SSH; with it, the box boots and `/mnt/suite-data` is an empty directory on the root
disk — and the app would happily create three fresh databases there and look like data loss. So add
a cheap guard to cron (step 8):

```sh
*/15 * * * * root mountpoint -q /mnt/suite-data || logger -t suite 'EBS data volume is NOT mounted'
```

Point the compose volume at that mount **before the first `docker compose up`**. Compose names the
volume `<project>_<volume>`, and a pre-created local volume with `driver_opts` binds it to the host
path:

```sh
sudo docker volume create --driver local \
  --opt type=none --opt device=/mnt/suite-data --opt o=bind \
  suite_suite-data
```

Check it resolves to the mount: `docker volume inspect suite_suite-data`. Snapshot the volume on a
schedule too (EBS lifecycle policy, daily) — it is a second, independent copy of the same data and
restores in minutes.

## 4. Security group (or Lightsail firewall)

| Port | Source | Why |
| --- | --- | --- |
| 80/tcp | `0.0.0.0/0` (or [Cloudflare ranges](https://www.cloudflare.com/ips-v4)) | HTTP→HTTPS redirect and ACME HTTP-01 challenges. |
| 443/tcp | `0.0.0.0/0` (or Cloudflare ranges) | The only public application port. |
| 22/tcp | **your IP /32 only** | SSH. Not `0.0.0.0/0`, not the office range "for now". |

Nothing else. The app's 1234/1235 are `expose`d inside the compose network and never published, so
the admin API and `/metrics` are reached through Caddy (the panel behind its token) or by running a
client inside the container:

```sh
TOKEN=$(grep -E '^SUITE_ADMIN_TOKEN=' .env | cut -d= -f2-)
docker run --rm --network "container:$(docker compose ps -q app)" curlimages/curl:8 \
  -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:1235/metrics | head
```

If you restrict 80/443 to Cloudflare's ranges, requests that bypass Cloudflare (including your own
`curl` from a laptop) stop working, which is the point; keep an SSH session open while you test.

## 5. DNS at Cloudflare

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| A | `canvas` | the Elastic/static IP | **Proxied** (orange cloud) |

Then, before the first certificate exists, either leave the record **DNS-only** until
`docker compose logs caddy` shows the certificate was issued, or keep it proxied but turn **Always
Use HTTPS** off until then. Why: the first Let's Encrypt validation needs plain HTTP on port 80; the
edge redirect refuses it before Caddy can answer. Renewals are fine afterwards — Let's Encrypt
follows the HTTPS redirect, and by then the origin certificate is valid.

If you would rather not expose the origin at all, that needs a Cloudflare Origin CA certificate
mounted into Caddy, which this Caddyfile does not do yet; the proxied setup above is the supported
path.

## 6. Cloudflare settings that matter

### TLS

- **SSL/TLS → Overview:** Full (strict). The origin presents a real Let's Encrypt certificate, so
  Flexible would be a downgrade and "Full" without strict skips validation.
- **Minimum TLS version:** 1.2.
- **Always Use HTTPS:** on (after the first certificate).
- **HSTS:** either let Caddy's `Strict-Transport-Security` header through or enable Cloudflare's —
  not both. This repo already sends it from Caddy.

### WAF rate-limiting rules

The server has its own per-address limiters (`SUITE_SHARE_CREATE_RATE_LIMIT` 30/min,
`SUITE_ADMIN_RATE_LIMIT` 300/min, …), but they run after the request has crossed the internet and
cost the process a socket. Put a cheap edge rule in front:

| Rule | Expression | Rate | Action |
| --- | --- | --- | --- |
| Share endpoints | `starts_with(http.request.uri.path, "/api/shares")` | 120 requests / 1 min / IP | Block, 60 s |
| Admin endpoints | `starts_with(http.request.uri.path, "/api/admin")` | 30 requests / 1 min / IP | Block, 60 s |

On the Free plan there is a single rate-limiting rule, so combine them into one:
`(starts_with(http.request.uri.path, "/api/shares") or starts_with(http.request.uri.path,
"/api/admin"))` at 120/min. On paid plans use both rows. The numbers sit below the server's own
`SUITE_SHARE_RESOLVE_RATE_LIMIT` (300/min) and above what a human can click, so a shared NAT full of
share-link viewers keeps working while a script does not. Block, not Managed Challenge: a challenge
page in front of a JSON API is useless to a client.

Remember what rate limits key on: with Cloudflare proxied, Caddy sees the Cloudflare edge address,
not the visitor. Leave `SUITE_TRUST_PROXY=0` (the default) unless you configure Caddy's global
`servers { trusted_proxies … }` for Cloudflare's ranges and set `SUITE_TRUST_PROXY=1`; with
`trusted_proxies` configured, Caddy keeps the real client address in `X-Forwarded-For` and the
server's per-address limiters work as intended. Without it, `SUITE_TRUST_PROXY=1` would make every
visitor of one edge share a bucket — worse than the default.

### Cache

- **Cache Rules → Bypass cache** when `starts_with(http.request.uri.path, "/api/") or
  starts_with(http.request.uri.path, "/ws")`. API responses already carry `Cache-Control: no-store`
  from Caddy, and WebSocket upgrades are never cacheable; the rule makes it explicit and stops a
  future "Cache Everything" from breaking a share.
- **Hashed assets.** Caddy sends `Cache-Control: public, max-age=31536000, immutable` for
  `/assets/*`, which Cloudflare honors. Set **Browser Cache TTL → Respect Existing Headers** in
  Speed → Optimization so the edge does not cap that year at four hours.
- **Never** add a "Cache Everything" page rule. There is no static origin behind this domain whose
  HTML can be cached safely: `index.html` and `admin.html` are `no-store` on purpose.

### Other switches

- **Network → WebSockets:** on (free, and required for `/ws`).
- **Speed → Brotli:** on. **Rocket Loader: off** — it rewrites script tags and breaks ES modules and
  the WASM bundle.
- **Email Obfuscation: off.** It rewrites HTML on the fly; nothing here needs it.
- **Do not enable "Under Attack Mode"** as a permanent setting: it challenges the WebSocket handshake
  and every share-link visitor.

### Uptime monitor

Point a monitor at `https://canvas.example.com/health` (expect `200` and the body `{"ok":true}`)
every minute from outside your network — a free external monitor (UptimeRobot, Better Stack) or
Cloudflare Health Checks on a paid plan. Additionally, `deploy/alert.sh` checks `/health`, the disk
watermark and RSS from inside the box and exits non-zero; run it from cron:

```sh
# /metrics is reached through Caddy, so the probe needs the public URL;
# 1235 is not published on the host.
*/5 * * * * root SUITE_ADMIN_TOKEN=<token> /srv/suite/deploy/alert.sh --url https://canvas.example.com >/dev/null
```

Two monitors catch different failures: the external one notices the instance being down, the local
one notices the instance being sick.

## 7. First boot

```sh
cd /srv/suite
cp .env.example .env
chmod 600 .env
```

Generate the credentials and put them in `.env` (each at least 16 characters, no whitespace):

```sh
openssl rand -base64 32     # SUITE_ADMIN_TOKEN — root credential, treat it like one
openssl rand -base64 32     # SUITE_PROJECTION_TOKEN
openssl rand -base64 32     # SUITE_SOURCE_TOKEN
```

Set `SUITE_DOMAIN=canvas.example.com`, `SUITE_ACME_EMAIL=ops@your-domain`,
`SUITE_IMAGE=ghcr.io/mr-rogers-neighborhood/suite:v1.4.0` (pin a release; `:latest` moves under you),
and — for a hosted relay — `SUITE_HOSTED=1` plus the licence public key:

```sh
# on a workstation with the repo and pnpm, not on the server:
pnpm --filter @suite/collab-server licence generate-keypair --out ./licence-private.pem
# prints the base64 public key -> SUITE_LICENCE_PUBLIC_KEY in .env
# keep licence-private.pem offline (password manager / secrets store), never in the repo

pnpm --filter @suite/collab-server licence sign \
  --key ./licence-private.pem --tier hosted --workspaces 25 \
  --document-bytes 5242880 --attachment-bytes 26214400 --days 365 \
  --email customer@example.com
# prints the licence token the customer pastes into the app
```

`SUITE_HOSTED=1` without a key refuses to boot, which is deliberate: a relay that cannot verify a
licence is an unlimited one. `SUITE_HOSTED=0` is a self-host: no licences, no quotas unless you set
them.

If you want limit overrides made in the admin panel to survive a restart, set
`SUITE_SETTINGS_DB=/data/settings.sqlite`. It is not in `deploy/backup.sh`'s snapshot, so a restore
reverts the overrides (see [Backups](#8-backups)).

Start everything. The first run pulls the pinned app image and builds the Caddy image from the
checkout:

```sh
docker compose pull app
docker compose up -d --build
docker compose ps
docker compose logs -f caddy        # wait for "certificate obtained successfully"
```

Then, from outside:

```sh
curl -fsS https://canvas.example.com/health          # {"ok":true}
curl -fsS -o /dev/null -w '%{http_code}\n' https://canvas.example.com/admin
```

Open the canvas, create a workspace, and **store the recovery key** — it is the only credential that
opens that workspace, and there is no account to reset.

Harden the panel if you want it reachable at all: uncomment the two `remote_ip` lines in
`deploy/Caddyfile`, list your office/VPN addresses, then rebuild Caddy:

```sh
docker compose build caddy && docker compose up -d caddy
```

## 8. Backups

`deploy/backup.sh` takes an online snapshot of the three databases (with `integrity_check`, per-file
SHA-256 and a manifest) and, when `SUITE_BACKUP_BUCKET` is set, uploads one tarball to S3 or R2.

```sh
sudo apt-get install -y sqlite3
# awscli v2, from AWS's installer:
curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o awscliv2.zip
unzip -q awscliv2.zip && sudo ./aws/install && rm -rf aws awscliv2.zip
# cron runs as root, so the profile lives in root's home:
sudo aws configure --profile suite-backup
```

Create the bucket with **versioning**, **Block Public Access** and default **SSE-S3** encryption, and
an IAM user whose policy is exactly what the script needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::suite-backups/suite/*"
    }
  ]
}
```

Environment for the script (root-readable only), because the databases live at the mount, not in the
repository's default location:

```sh
sudo install -m 600 /dev/null /etc/suite/backup.env
sudo tee /etc/suite/backup.env >/dev/null <<'EOF'
SUITE_DATA_DIR=/mnt/suite-data
SUITE_DB=/mnt/suite-data/documents.sqlite
SUITE_SHARES_DB=/mnt/suite-data/shares.sqlite
SUITE_WORKSPACES_DB=/mnt/suite-data/workspaces.sqlite
SUITE_BACKUP_BUCKET=s3://suite-backups
SUITE_BACKUP_PREFIX=suite
AWS_PROFILE=suite-backup
AWS_DEFAULT_REGION=eu-west-1
EOF
```

Cron, nightly, plus local pruning and the mount guard:

```sh
20 3 * * * root set -a; . /etc/suite/backup.env; set +a; /srv/suite/deploy/backup.sh /srv/backups >> /var/log/suite-backup.log 2>&1
40 3 * * * root find /srv/backups -mindepth 1 -maxdepth 1 -name 'suite-*' -mtime +14 -exec rm -rf {} +
*/15 * * * * root mountpoint -q /mnt/suite-data || logger -t suite 'EBS data volume is NOT mounted'
```

**Retention: 7 daily + 4 weekly, enforced by the bucket.** The script uploads every run to
`suite/daily/` and Sunday's run additionally to `suite/weekly/`. Apply the lifecycle rule once:

```sh
aws s3api put-bucket-lifecycle-configuration --bucket suite-backups \
  --lifecycle-configuration '{"Rules":[
    {"ID":"daily-7","Status":"Enabled","Filter":{"Prefix":"suite/daily/"},"Expiration":{"Days":7}},
    {"ID":"weekly-35","Status":"Enabled","Filter":{"Prefix":"suite/weekly/"},"Expiration":{"Days":35}}
  ]}'
```

That leaves seven daily and four weekly copies (up to 35 days of history). Prune locally only after
an upload has succeeded at least once — the cron above keeps two weeks on disk.

Three honest notes:

- Snapshots are **unencrypted**, plaintext workspace content plus share and owner hashes. The bucket
  is encrypted at rest; the local directory is protected by EBS encryption and root-only permissions.
  For stronger off-site guarantees, wrap the upload in `gpg` and adjust the script.
- The three snapshots are taken one after another, not in one cross-file transaction. A link created
  in the gap can miss its projection (the next projection run fixes it) and a save in the gap is one
  save behind. For a byte-exact point in time, stop `app` first.
- `settings.sqlite` (runtime limit overrides) is not part of a snapshot; a restore reverts overrides.

## 9. Restore drill

Monthly, read-only:

```sh
/srv/suite/deploy/restore.sh "$(ls -d /srv/backups/suite-*/ | tail -1)" --verify-only
```

It re-checks the manifest, sizes and SHA-256 and runs `PRAGMA integrity_check` on every file, and
touches nothing else. Do this on the 1st of the month; a backup you have never verified is a hope.

Quarterly, full: on a scratch instance with an **empty** volume (no `--force` needed, nothing at
risk), or during a maintenance window on the live box:

```sh
/srv/suite/deploy/restore.sh /srv/backups/suite-20261023T001541Z --force
```

What the script does, in order: verify the snapshot → refuse a non-empty volume without `--force` →
stop `app` → delete the three main files **and their stale `-wal`/`-shm` sidecars** → copy the
snapshot in → start `app` → require `/health` to answer within 90 s. Check the workspace you know
best and one share link, then note how long the whole thing took; that number is your RTO.

On the live box, remember Caddy keeps proxying while `app` is down: visitors see 502 for the length
of the copy, which is seconds for a few GB.

## 10. Upgrade by image tag

```sh
cd /srv/suite
# 1. a backup first, always
sudo bash -c 'set -a; . /etc/suite/backup.env; set +a; /srv/suite/deploy/backup.sh /srv/backups'
# 2. pin the new release in .env: SUITE_IMAGE=ghcr.io/mr-rogers-neighborhood/suite:v1.5.0
$EDITOR .env
# 3. swap only the app; Caddy keeps running
docker compose pull app
docker compose up -d app
curl -fsS https://canvas.example.com/health
```

- The tag travels into the process as `SUITE_VERSION`, visible in `/metrics`,
  `/api/admin/status` and the `server ready` log line.
- Rolling back is setting the previous tag and repeating. The stores migrate forward on open, so a
  rollback after a schema change is a **restore**, not a tag change — that is what the backup is for.
- Changes to `deploy/Caddyfile` need a Caddy rebuild, because the file is baked into the image:
  `docker compose build caddy && docker compose up -d caddy`. Expect a couple of seconds of 502.
- Caddy's certificates live in the container unless you enable the commented `caddy-data` volume in
  `compose.yaml`. Recreating Caddy often without it re-issues certificates until Let's Encrypt's
  five-per-week duplicate limit stops you.

## What not to do

- **No second `app` replica.** Not `--scale app=2`, not an Auto Scaling Group, not a load balancer.
  Two processes against one volume corrupt each other's SQLite locking assumptions and split live
  rooms; two volumes behind one hostname silently split workspaces.
- **No SQLite on a network filesystem.** EFS/NFS/SMB break locking and WAL shared memory. Do not
  attach one EBS volume to two instances (Multi-Attach) either.
- **No backups inside `/data`.** A copy on the same volume dies with the volume, inflates every
  subsequent snapshot, and makes `restore.sh`'s non-empty check meaningless. `/srv/backups` is a
  different disk; the bucket is a different account boundary.
- **Never `docker compose down -v`.** It removes the volume; the databases are the product.
- **No instance-store or spot-only data.** If the instance is replaced, the EBS volume must survive
  and re-attach.
- **Do not expose `/metrics` or `/admin` publicly.** Both are token-gated, and that token is
  all-or-nothing; use the IP allowlist or an SSH tunnel.
- **Do not enable `file_server browse`**, and do not serve `/srv` from anything else — hashed-asset
  caching and the `no-store` HTML headers live in `deploy/Caddyfile`.
- **Do not run two Caddy containers.** They compete for the certificate.
- **Do not put the admin token in a URL** or a shell history you share; the panel stores it in
  `sessionStorage` for the same reason.

## 11. Cost

List prices, one small instance, excluding tax and any Savings Plan or free tier. Check current
prices before quoting this to anyone.

| Item | Monthly |
| --- | --- |
| Lightsail 2 GB (1 vCPU, 60 GB SSD, 3 TB transfer) | **~$12** |
| *or* EC2 `t4g.small` on-demand + 20 GB gp3 + public IPv4 | ~$12 + ~$1.60 + ~$3.60 ≈ **~$17** |
| 4 GB step (`t4g.medium`, or Lightsail 4 GB) | **~$24–30** |
| EBS snapshots (20 GB, a few changed blocks a day) | ~$1–2 |
| S3 backups (≈5 GB, versioned, SSE) + requests | ~$0.20 |
| Cloudflare Free (proxy, TLS, WAF rule, cache rules) | **$0** |
| External uptime monitor | $0 on a free tier |
| **Total, 2 GB instance** | **≈ $13 (Lightsail) to ≈ $20 (EC2 + EIP)** |

The cost that is not on this table is the one that bites: a root volume filling up because images,
logs and local snapshots share it, or a box swapping because one board share rebuilds every few
seconds on a single core. Both are cheaper to prevent (upload and prune, `mem_limit`, a bigger
instance) than to recover from.

**Scaling means more instances, each with its own workspaces** — not replicas of one. The product is
single-replica by design; ten instances serving ten separate sets of workspaces is the only shape
that works, and it costs ten times one instance.
