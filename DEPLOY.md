# Masjid E Shameem – Chanda Manager · Permanent Cloud Deployment

This repository ships everything needed to run the application **permanently on a
cloud server**, independent of any personal laptop:

```
Phone / Tablet / Laptop
        │  HTTPS
        ▼
   Caddy (TLS termination, auto-HTTPS)
        │
        ▼
   Node.js / Express (container, auto-restart)
        │
        ▼
   Persistent SQLite volume  ──►  nightly SQLite-safe backups (off-box)
```

> **Beginner walkthrough (Windows PC → DigitalOcean VPS, copy-paste, from
> zero): see [DEPLOY-WINDOWS.md](DEPLOY-WINDOWS.md).**
>
> **Zero-cost alternative (Oracle Cloud Always Free, with cost verification,
> block-volume persistence, DuckDNS/domain HTTPS, and recovery): see
> [OCI-DEPLOY.md](OCI-DEPLOY.md).**
>
> This file is the reference; the walkthroughs are the step-by-step.

Everything below has been **verified locally in production mode** (Secure
cookies, health probe, PWA manifest/service worker, demo gates, backup +
restore round-trip). What has **not** happened is the actual cloud deploy —
that requires your hosting account, and it is **not** complete until a real
public HTTPS URL responds (see §12). The temporary Cloudflare tunnel from the
testing phase is **not** this deployment.

---

## 1. Recommended hosting platform

**Primary: a small Linux VPS (Hetzner CX22, DigitalOcean Basic, or similar)
running Docker + Caddy.** Budget ~€4–6/month.

Why a plain VPS over a serverless/container PaaS for this specific app:

- **The database is a single SQLite file.** It needs a *persistent disk
  mounted at a fixed path* — trivial on a VPS (a Docker volume or bind mount),
  but a mismatch on platforms with ephemeral filesystems (many free/serverless
  tiers wipe `/app` on every deploy).
- **Always-on, no cold starts or sleep.** Free tiers of managed platforms put
  web services to sleep after inactivity; a masjid treasurer opening the app at
  any hour must never wait 30+ seconds for a cold start.
- **The app has zero build step** and one tiny container — resource needs are
  minimal (256 MB RAM is plenty), so even the smallest VPS is overkill.
- **Backups are easy and off-box**: the repo's `npm run backup` writes
  timestamped `VACUUM INTO` snapshots to `BACKUP_DIR`, and a simple cron job +
  `rsync`/`rclone` pushes them to another location.

**Managed alternative:** Fly.io (free tier includes a persistent volume and a
`*.fly.dev` HTTPS domain) or Railway (built-in volumes). The same `Dockerfile`
works on both — see §13 for the one-line differences. Choose these if you
prefer no server administration at all.

---

## 2. Why this architecture is compatible

| Requirement | How it is satisfied |
|---|---|
| Node.js ≥ 22.13 | `Dockerfile` uses `node:22-bookworm-slim`; `package.json` pins `engines.node >=22.13.0` (built-in `node:sqlite`, built-in `.env` loader — no native modules, no build step) |
| Persistent disk/volume | Named volume `masjid-data` mounted at `/app/data`; `DB_PATH=/app/data/chanda.db` lives there across restarts, redeploys, and `docker compose down` |
| HTTPS | Caddy terminates TLS, auto-issues/renews Let's Encrypt certs, redirects HTTP→HTTPS |
| Environment variables | `.env` on the host (never committed; see §5) |
| Long-running process | `restart: unless-stopped` on both services; Docker daemon restarts them after crashes and host reboots |
| Automatic restart | Same as above (plus the app itself is stateless apart from the DB file) |

---

## 3. Required account setup

1. **VPS provider** — sign up at Hetzner, DigitalOcean, etc., create a
   **smallest Linux (Ubuntu 24.04 / Debian 12) server** with a public IP.
   (Oracle Cloud's Always Free tier also works.)
2. **SSH** — add your public key; you'll connect with
   `ssh root@<server-ip>`.
3. **Domain name** — register one (e.g. `masjid-shameem.org`) and create a DNS
   **A record** (and AAAA if the VPS has IPv6) pointing at the server IP.
   Caddy needs the domain to issue the free HTTPS certificate. A domain costs
   ~$10–15/year and is the only thing giving you a stable, permanent URL.
4. **On the server** — install Docker Engine + Compose plugin
   (`curl -fsSL https://get.docker.com | sh`).

---

## 4. Required GitHub connection

**None required.** This stack deploys directly from the repository folder over
SSH — no GitHub account, token, or webhook is needed:

```
scp -r <project-folder> root@<server-ip>:/opt/masjid-shameem
```

(GitHub is optional: if you push the repo and later want CI, the same
`Dockerfile` can build in GitHub Actions — but it is not part of this path.)

---

## 5. Required environment variables

On the server, inside `/opt/masjid-shameem`:

```bash
cp .env.example .env
```

Then set, at minimum:

| Variable | Value for this deployment | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables Secure cookies, trust-proxy, demo gates |
| `PORT` | `3000` | Container default; Caddy proxies to it |
| `DB_PATH` | `/app/data/chanda.db` | **Container path** — on the persistent volume (compose already sets this; do not point it at the host path) |
| `COOKIE_SECURE` | `1` (or leave default — production already forces Secure) | |
| `INITIAL_ADMIN_EMAIL` | your real email | **First run only** — see §10; remove after bootstrap |
| `INITIAL_ADMIN_PASSWORD` | a strong, unique password | **First run only**; remove after bootstrap, never commit |

Never set `SEED_DEMO_USERS`, `SEED_SAMPLE_DATA`, or `DEMO_MODE=true` on this
server — demo accounts and the sample-data reset stay disabled in production.
`.env` is read at boot by Node's built-in loader; existing env vars win.

---

## 6. Persistent disk / volume configuration

The compose file declares a named volume `masjid-data` mounted at `/app/data`:

- SQLite database: `/app/data/chanda.db` (WAL mode; `-wal`/`-shm` sidecars
  beside it)
- Backups: `/app/data/backups/` (the script's default `BACKUP_DIR`)

`docker compose down` and image rebuilds **do not** remove named volumes, so
the data survives restarts, redeploys, and server reboots. If you prefer, swap
the named volume for a bind mount to a host directory on a separate disk, e.g.
`/mnt/data:/app/data`. Whatever you choose, that path must be on a disk that is
**not** wiped by the platform (avoid ephemeral instance storage).

---

## 7. Deployment command

On your laptop (or CI):

```bash
npm run build            # optional locally — the Dockerfile stamps the version itself
```

On the server:

```bash
cd /opt/masjid-shameem
cp .env.example .env     # first time only — fill in real values (§5)
docker compose up -d --build
docker compose ps        # both services healthy?
```

Every future release = copy the new files over + `docker compose up -d --build`
again. The volume keeps the data; Caddy keeps the certificate.

---

## 8. HTTPS / domain configuration

Edit `Caddyfile` and replace `masjid.example.org` with your domain **before**
the first `docker compose up`:

```
masjid.example.org {
    encode gzip
    reverse_proxy app:3000
}
```

Caddy automatically:
- obtains a Let's Encrypt certificate (ports 80/443 must be open in the cloud
  firewall),
- renews it automatically,
- redirects plain HTTP to HTTPS.

Inside the app: `NODE_ENV=production` enables `trust proxy`, so
`req.secure` is true and the session cookie is issued
`HttpOnly; Secure; SameSite=Lax` (verified against the public tunnel earlier).
No mixed content: the app serves only same-origin assets.

---

## 9. Backup schedule

The existing SQLite-safe mechanism (`npm run backup`) uses `VACUUM INTO`, which
produces a **consistent snapshot even while the app is running**, verifies each
backup (`PRAGMA integrity_check` + row counts) before reporting success, uses
timestamped filenames that never overwrite, and stores files in `BACKUP_DIR`
(default `/app/data/backups/`, i.e. the persistent volume).

**Recommended schedule (on the server, as root):**

> The VPS host itself has no Node.js (the app runs in Docker), so backup
> commands must run **inside the container** via `docker compose exec`.

```bash
crontab -e
# Daily at 23:00 — verified VACUUM INTO backup, written to /app/data/backups
# (the persistent volume), keeping timestamps so nothing is ever overwritten.
0 23 * * * cd /opt/masjid-shameem && docker compose exec -T app node scripts/backup.mjs >> /var/log/masjid-backup.log 2>&1
# Weekly at 03:10 — pull the backup files OUT of the volume onto the host disk
10 3 * * 1 cd /opt/masjid-shameem && docker compose exec -T app tar -czf - /app/data/backups > /root/masjid-backups-$(date +\%F).tgz
# (optional, for true off-box protection) also rsync/rclone /root/*.tgz to
# another machine or cloud bucket — a volume loss then costs at most one day.
```

Because `data/backups` sits on the same volume as the DB, the weekly tar step
(or an rsync/rclone line) copies the backups **off-box** — a volume loss then
still costs at most one day. A simple beginner-friendly off-box option is to
pull the latest backup to your own PC once a week:

```bash
# from Windows PowerShell, after the weekly tar ran:
scp root@<VPS-IP>:/root/masjid-backups-*.tgz "C:\Users\<You>\Documents\MasjidBackups\"
```

**Verify a backup is real** (not just a file): the script already refuses to
report success unless the file opens, passes `integrity_check`, and matches the
live row counts. Spot-check manually:

```bash
docker compose exec app node scripts/backup.mjs     # shows the verified file
```

---

## 10. First Admin creation (no demo accounts, ever)

Production never creates demo accounts. On the **first** start, with a fresh
empty volume, either:

**Option 1 — automatic bootstrap (simplest).** Set `INITIAL_ADMIN_EMAIL` and
`INITIAL_ADMIN_PASSWORD` in `.env`, start the stack, then **remove both
variables** and change the password in Settings. The server logs a loud warning
if they are left behind.

**Option 2 — manual.** Start the stack without the variables (the boot log
prints the exact command), then:

```bash
docker compose exec app node scripts/create-user.mjs \
  --name "Your Name" --email "you@example.org" --role admin
```

After that, the Admin creates individual Treasurer accounts in
**Manage Users** (unique login, own password, role, active/inactive). No shared
accounts.

---

## 11. Production verification checklist

Run this on the deployed URL after first boot:

- [ ] `GET https://<domain>/api/health` → `{"ok":true,...,"db":"ok"}` (and a
      503 when the DB is unreachable — verified behavior)
- [ ] `GET /api/config` → `{"demoUsers":false,"demoMode":false}`
- [ ] Log in as the first Admin; session cookie shows `HttpOnly; Secure;
      SameSite=Lax` (DevTools → Network → login request)
- [ ] `POST /api/settings/reset-sample-data` → **403** (admin or not)
- [ ] Dashboard shows your real data, zero sample data
- [ ] `GET /manifest.webmanifest` → `application/manifest+json`, name
      "Masjid E Shameem – Chanda Manager", `display: standalone`
- [ ] `GET /sw.js` → 200; `APP_VERSION` stamped per deploy; `/api/` never
      cached
- [ ] Android Chrome offers **Install app / Add to Home screen**; app launches
      standalone
- [ ] Record a Cash, UPI, and Split collection on the phone → appears on the
      laptop immediately (same DB)
- [ ] Duplicate payment for the same house+month → blocked (409)
- [ ] Monthly/Annual PDFs download; Share PDF works on Android
- [ ] `docker compose exec app node scripts/backup.mjs` → verified backup file
- [ ] Reboot the server → app and data come back (restart policy + volume)

---

## 12. Permanent public HTTPS URL

**Not yet deployed — this step requires your action.** This environment has no
hosting credentials, and per the project rule the deployment is only
"complete" when a real public URL answers HTTPS. After you complete §3–§10 on a
VPS, the permanent URL is:

```
https://<your-domain>/        # e.g. https://masjid-shameem.org/
```

The temporary `*.trycloudflare.com` tunnel from the testing phase is NOT this
URL and must not be shared with the committee.

---

## 13. Managed-platform notes (optional)

The same image runs on managed platforms with near-zero changes:

- **Fly.io** — `fly launch` from the repo; add `[mounts] source="data"
  destination="/app/data"` and set `DB_PATH=/app/data/chanda.db`; `fly
  secrets set` for env vars; HTTPS on `<app>.fly.dev` is automatic.
- **Railway** — connect the repo (or `railway up`), add a volume mounted at
  `/app/data`, set the same env vars; HTTPS on `<project>.up.railway.app`.
- **Render** — needs the paid Starter plan for a persistent disk; mount it at
  `/app/data`.

All three already satisfy "persistent volume + HTTPS + env vars + auto-restart"
at the cost of vendor lock-in and (for the free tiers) possible sleep/cold
starts — which is why the VPS + Caddy stack is the primary recommendation.

---

## Restore procedure (reference — do not run against the live server casually)

Full recovery steps (from §5c of the README and `scripts/restore.mjs`):

1. `docker compose stop app` (Caddy may stay up)
2. `docker compose run --rm -v masjid-data:/app/data app node scripts/restore.mjs /app/data/backups/Masjid_E_Shameem_backup_YYYY-MM-DD_HHMMSS.db`
3. The script validates the backup (integrity + expected tables), requires
   typing `RESTORE`, replaces the live DB, removes stale `-wal`/`-shm`, and
   re-verifies the restored file
4. `docker compose start app`
5. Verify: login as Admin → households → payments → monthly/annual reports

A backup is only trustworthy if it passed the script's verification when it was
created — the script deletes unverifiable files and exits non-zero.
