# Masjid E Shameem — Windows → VPS Deployment Guide (beginner)

This guide takes you from **zero** (no VPS, no domain) to a **permanent public
HTTPS deployment** that keeps working after your laptop is switched off.

Every command below is labelled:

- **WINDOWS COMMAND** — run in **PowerShell** on your Windows PC (press
  <kbd>⊞ Win</kbd>, type `powershell`, press Enter). PowerShell is already on
  your PC — no extra software needed.
- **VPS COMMAND** — run on the server, *after* you have SSH'd into it (step 9).

Placeholders you must replace:

| Placeholder | Replace with |
|---|---|
| `<VPS-IP>` | your server's public IP (step 6) |
| `<domain>` | your real domain, e.g. `masjid-shameem.org` (step 7) |
| `<YOUR-ADMIN-PASSWORD>` | a strong password **you** choose (step 15) |
| `<you@example.org>` | your real email (step 15) |

> Read the whole guide once before starting. The whole thing takes about
> 45–60 minutes the first time, mostly waiting for installs and DNS.

---

## Step 0 — Which VPS provider?

| | **DigitalOcean** (recommended) | Hetzner |
|---|---|---|
| Price | $6/month (1 GB RAM, 1 CPU, 25 GB SSD) | ~€4/month (more powerful) |
| Beginner-friendliness | ✅ Very high — clear UI, huge tutorials, one-click options | Medium — simpler but steeper UI |
| Extra IPv4 fee | No | ~€0.50/month on new servers |
| Docs/tutorials | Excellent | Good, less beginner-oriented |

**Recommendation: DigitalOcean** for this app. It is the easiest first VPS
experience, the $6 droplet is far more than this app needs (Node + SQLite is
tiny), and it has built-in firewall and one-click images. Hetzner is the budget
alternative once you are comfortable.

Region: pick the one closest to your users (for India: **Bangalore/Mumbai** or
**Singapore**) — this affects app speed, not correctness.

---

## Step 1 — Create the VPS account

1. Go to <https://cloud.digitalocean.com> → **Sign up** (Google or email).
2. Verify your email.
3. **Add a payment method** (card or PayPal) — required to create droplets.
   A $6 droplet is ~$6/month.

## Step 2 — Select the server size

- Plan: **Basic** (not Premium)
- Size: **$6/month — Regular, 1 GB RAM / 1 vCPU / 25 GB SSD**
  (the $4 / 512 MB one also works; the $6 leaves comfortable headroom)

## Step 3 — Select Ubuntu

- In the droplet creation screen, under **Choose an image**: **Ubuntu** →
  **24.04 LTS x64**.
  (Alternative: the "Docker" one-click image is also Ubuntu with Docker
  pre-installed — if you pick it, you can skip step 11.)

## Step 4 — Create an SSH key (on your Windows PC)

An SSH key is your secure "password" to the server — much safer than a typed
password.

**WINDOWS COMMAND** (PowerShell):

```powershell
ssh-keygen -t ed25519 -C "masjid-deploy"
```

Press Enter to accept the default location (`C:\Users\<you>\.ssh\id_ed25519`)
and optionally set a passphrase. Then display the **public** key:

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

Copy the whole line it prints (starts with `ssh-ed25519 ...`).

## Step 5 — Create the VPS (droplet)

1. DigitalOcean → **Create → Droplets**
2. Region: nearest to your users (Mumbai/Bangalore/Singapore for India)
3. Image: Ubuntu 24.04 LTS x64 (step 3)
4. Size: Basic $6 (step 2)
5. **Authentication**: choose **SSH key** → click **New SSH Key** → paste the
   key from step 4 → save
6. (Optional) set a hostname like `masjid-shameem`
7. Click **Create Droplet**

The droplet is ready in ~30–60 seconds.

## Step 6 — Find the public IP

In the DigitalOcean control panel, open your droplet. The **IPv4** address at
the top is `<VPS-IP>` — note it down. Example: `159.89.12.34`.

## Step 7 — Register / buy a domain

You need a domain so users get a stable `https://<domain>` URL and Caddy can
issue a free HTTPS certificate. Register at **Porkbun**, **Namecheap**, or
**Cloudflare Registrar** (all cheap, ~$10–15/year, no upsells).

Example: `masjid-shameem.org` (or any name that is still available).

## Step 8 — Configure the DNS A record

At your registrar's DNS panel (or Cloudflare's free plan after you move the
domain's nameservers there), create:

| Type | Name | Value | Purpose |
|---|---|---|---|
| `A` | `@` | `<VPS-IP>` | makes `https://<domain>` point at your server |
| `A` | `chanda` | `<VPS-IP>` | *(optional)* makes `https://chanda.<domain>` point at your server |

Notes:

- `@` means the domain itself (the "apex"). `chanda` is a subdomain.
- Use **only one** of these as your final address. Using the subdomain
  `chanda.<domain>` is cleaner if the domain will later host other things —
  but if you choose it, the Caddyfile in step 15 must say `chanda.<domain>`.
- DNS can take a few minutes to a few hours to spread. Verify from Windows:

**WINDOWS COMMAND:**

```powershell
nslookup <domain>
```

It should eventually show your `<VPS-IP>`. Proceed once it does.

## Step 9 — Connect to the VPS from Windows (SSH)

**WINDOWS COMMAND:**

```powershell
ssh root@<VPS-IP>
```

- First time: type `yes` when asked to accept the server's fingerprint.
- You should now see a prompt like `root@masjid-shameem:~#`.

**Everything from here on runs on the server — label it VPS COMMAND.**

## Step 10 — Update the server

**VPS COMMAND:**

```bash
apt update && apt upgrade -y
```

(Let it finish; a reboot is not required for this install.)

## Step 11 — Install Docker and Docker Compose

**VPS COMMAND:**

```bash
curl -fsSL https://get.docker.com | sh
```

Then verify both tools:

```bash
docker --version && docker compose version
```

Both should print versions (compose comes bundled with the installer).

## Step 12 — Create `/opt/masjid-shameem`

**VPS COMMAND:**

```bash
mkdir -p /opt/masjid-shameem && cd /opt/masjid-shameem
```

## Step 13 — Upload the project from Windows to the VPS

This copies the project **without** your local `node_modules` and `data`
folders — the server builds its own dependencies, and the production database
starts **clean** (your local records stay local; see the migration note at the
end of this step).

**WINDOWS COMMAND** (PowerShell):

```powershell
cd "C:\Users\Mohd Shoeb\Desktop\Chanda App"
tar --exclude=node_modules --exclude=data --exclude=.git -czf "$env:TEMP\masjid-deploy.tgz" .
scp "$env:TEMP\masjid-deploy.tgz" root@<VPS-IP>:/opt/masjid-shameem/
```

(scp will ask for your SSH key passphrase if you set one. The upload is a few
hundred KB — a few seconds.)

**VPS COMMAND:**

```bash
cd /opt/masjid-shameem
tar -xzf masjid-deploy.tgz
rm masjid-deploy.tgz
ls
```

You should see `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `DEPLOY.md`,
`server.js`, `package.json`, `public/`, `scripts/`, `routes/`, `lib/` — and
**no** `data/` or `node_modules/` folder. That is correct.

> **Migration note:** if you later want the VPS to start with the records you
> already entered locally (e.g. 7-473 Sultana Begum), don't copy the live DB
> file — copy a **backup** instead, and restore it per DEPLOY.md §Restore.
> The backup script guarantees a consistent snapshot; a raw file copy does not.

## Step 14 — Configure `.env`

**VPS COMMAND:**

```bash
cd /opt/masjid-shameem
cp .env.example .env
apt install -y nano   # only needed if "nano: command not found"
nano .env
```

In the nano editor (arrows to move, `Ctrl+O` to save, `Ctrl+X` to exit):

- Leave `NODE_ENV=production` and `PORT=3000` as they are.
- Leave `DB_PATH` commented out — `docker-compose.yml` already sets it to the
  persistent-volume path automatically.
- Uncomment and fill in the two **Initial Admin** lines (see step 15).

Then lock down the file so only root can read it:

```bash
chmod 600 .env
```

`.env` is excluded from Git and from the Docker image — it never leaves the
server.

## Step 15 — Configure the real production Admin bootstrap

In `.env` (same file as step 14), set:

```
INITIAL_ADMIN_EMAIL=<you@example.org>
INITIAL_ADMIN_PASSWORD=<YOUR-ADMIN-PASSWORD>
```

- Use a **real email you control** and a **strong, unique password** you
  choose. Do not reuse a password from anywhere else. (The app hashes
  passwords with scrypt; nothing is stored in plaintext.)
- These two lines are used **once**, on the very first start, to create the
  first real Admin — and only if the database is empty. Demo accounts are
  never created in production.
- **Remove these two lines after the first successful start** (step 17, then
  step 16's note) — the server logs a loud warning if you leave them. Removing
  them does **not** delete the Admin; it only stops future restarts from
  re-running the bootstrap.

Also now, in this same step, point Caddy at your real domain:

**VPS COMMAND:**

```bash
nano Caddyfile
```

Replace `masjid.example.org` with your real domain (the same one you put in
the DNS A record in step 8 — `chanda.<domain>` if you chose the subdomain).
Save and exit.

## Step 16 — Verify demo users / sample data stay disabled

*The app must be running first (step 17) — do this check right after it.*

**VPS COMMAND:**

```bash
curl -s https://<domain>/api/config
```

Expected: `{"demoUsers":false,"demoMode":false}`

- `demoUsers:false` — the demo logins (`admin@shameem.example` /
  `treasurer@shameem.example`) do **not** exist and cannot log in (they return
  401).
- `demoMode:false` — the **Reset Sample Data** action is disabled: hidden from
  the UI, and the API rejects it with 403 even when called directly by an
  authenticated Admin (verified in the project's test matrix).

And confirm no sample data was seeded — log in at `https://<domain>` (the
Admin from step 15) and check the **Dashboard**: the counts should all be **0**
until you add real records.

## Step 17 — Start the application with Docker Compose

**VPS COMMAND:**

```bash
cd /opt/masjid-shameem
docker compose up -d --build
```

The first run builds the image (a few minutes — mostly downloading the Node
base image). Afterwards:

```bash
docker compose ps
```

Both services (`app`, `caddy`) should show `running` and `healthy`.

Check the app's boot log for the Admin bootstrap:

```bash
docker compose logs app --tail 30
```

You should see a line like
`⚠ PRODUCTION: initial Admin created for <you@example.org> from environment
variables…` — this is your cue for step 15: **now** remove the two
`INITIAL_ADMIN_*` lines from `.env` and restart:

```bash
nano .env          # comment out or delete INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD
docker compose up -d
```

## Step 18 — Verify the Node application

**VPS COMMAND:**

```bash
curl -s https://<domain>/api/health
```

Expected: `{"ok":true,"name":"Masjid E Shameem – Chanda Manager","version":"1.0.0","uptime":…,"db":"ok"}`

If it returns anything else, debug with:

```bash
docker compose logs app --tail 50
docker compose logs caddy --tail 50
```

## Step 19 — Verify the SQLite persistent volume

**How the paths map:**

| Where | Path |
|---|---|
| In the container | `/app/data/chanda.db` |
| On the persistent volume | named volume `masjid-data` (Docker-managed, lives at `/var/lib/docker/volumes/masjid-data/_data` on the host) |
| In the Docker image | **not present** — `.dockerignore` excludes `data/`, so the image never contains a database |
| Backups | `/app/data/backups/` — same volume, separate folder from the live DB |

**VPS COMMAND:**

```bash
docker volume ls                              # shows masjid-data
docker compose exec app ls -la /app/data      # chanda.db should exist here
```

Because the DB lives in the volume (not the image and not your uploaded
folder), it survives every restart and redeploy — proven in step 27/28.

## Step 20 — Verify Caddy

**VPS COMMAND:**

```bash
docker compose logs caddy --tail 30
```

Look for lines like `certificate obtained successfully` or `served
certificate`. If you see ACME errors, the DNS record from step 8 hasn't spread
yet or ports 80/443 are blocked — Caddy retries automatically, so fix the cause
and it recovers.

## Step 21 — Verify HTTPS

- Open `https://<domain>` in a browser on your Windows PC — the browser padlock
  should show a valid certificate (no warning), and any visit to
  `http://<domain>` should **redirect** to `https://`.
- **VPS COMMAND** to see the certificate (runs on the host, which has
  openssl):

```bash
docker compose logs caddy --tail 30 | grep -i certificate
echo | openssl s_client -connect <domain>:443 -servername <domain> 2>/dev/null | grep subject=
```

The second line prints the certificate's subject (your domain) and issuer
(Let's Encrypt) — proof that TLS is real and trusted.

- Ports required open (inbound): **80** (HTTP→HTTPS redirect + certificate
  issuance) and **443** (HTTPS). **22** for SSH administration. Nothing else.

## Step 22 — Verify `/api/health` (already covered)

Step 18's check is the health check — `ok:true` and `db:"ok"` mean the process
is up **and** the database is reachable. If the DB ever becomes unreachable the
endpoint returns HTTP 503 with `"db":"error"` (no secrets in the response).

## Step 23 — Verify PWA installability

- `https://<domain>/manifest.webmanifest` → loads as `application/manifest+json`
  with name **"Masjid E Shameem – Chanda Manager"**, `display: standalone`.
- `https://<domain>/sw.js` → loads; contains `APP_VERSION`; API requests are
  never cached.
- Chrome on Android will therefore offer **Install app / Add to Home screen**
  (step 24).

## Step 24 — Test the application from Android

1. Open **Chrome** on the Android phone → go to `https://<domain>`
2. Log in with the real Admin (the account from step 15)
3. Tap Chrome **⋮ menu → Install app / Add to Home screen** → confirm
4. Launch the installed **Masjid E Shameem** app — it opens **full-screen**
   (standalone, no address bar)
5. Run a full collection test: Add Household → Add Collection → Cash → UPI →
   Split → Search → History → Monthly report → PDF → **Share**
6. Do the same entry from your laptop — the record appears on the phone
   immediately (one shared database)
7. Turn off the phone's Wi-Fi → the app shows the **NO INTERNET
   CONNECTION** banner and saving is blocked — no fake "saved" messages

## Step 25 — Configure daily backups

The backup uses the project's SQLite-safe mechanism (`VACUUM INTO` — a
consistent snapshot even while the app is running, verified before it is
reported as successful, timestamped so nothing is ever overwritten).

**VPS COMMAND:**

```bash
crontab -e
```

(Choose `1` for nano if asked.) Add these two lines:

```
# Daily 23:00 — verified backup written to the persistent volume
0 23 * * * cd /opt/masjid-shameem && docker compose exec -T app node scripts/backup.mjs >> /var/log/masjid-backup.log 2>&1
# Weekly 03:10 — pull backups off the volume to the host disk
10 3 * * 1 cd /opt/masjid-shameem && docker compose exec -T app tar -czf - /app/data/backups > /root/masjid-backups-$(date +\%F).tgz
```

(Backups run **inside the container** because the VPS host itself has no
Node.js — the `docker compose exec` form does this. The weekly tar moves them
off the volume; for true off-box protection also rsync/rclone the `/root/*.tgz`
files to another machine or cloud bucket once a week, or pull them to your PC:
`scp root@<VPS-IP>:/root/masjid-backups-*.tgz "C:\Users\<you>\Documents\MasjidBackups\"`.)

## Step 26 — Verify backup integrity

Run the backup once manually (this is safe — it never touches the live DB):

**VPS COMMAND:**

```bash
cd /opt/masjid-shameem
docker compose exec -T app node scripts/backup.mjs
docker compose exec app ls -la /app/data/backups/
```

You should see `✓ Backup created and verified: … integrity_check: ok · rows:
users=…, households=…, payments=…` and a file named
`Masjid_E_Shameem_backup_YYYY-MM-DD_HHMMSS.db`. A backup is only ever reported
successful if it opens, passes `PRAGMA integrity_check`, and matches the live
row counts — a backup that fails verification is deleted and the command exits
non-zero.

## Step 27 — Test a safe server restart

**VPS COMMAND:**

```bash
docker compose restart
curl -s https://<domain>/api/health
```

Expected: the app comes back healthy within seconds (restart policy
`unless-stopped` also brings both services back after a server reboot or
crash).

## Step 28 — Confirm the database survives restart

**VPS COMMAND:**

```bash
docker compose down          # stops AND removes the containers (volume stays)
docker compose up -d         # recreates them
curl -s https://<domain>/api/health
docker compose exec app node -e "import('./db.js').then(({db})=>console.log('households:',db.prepare('SELECT COUNT(*) n FROM households').get().n,'| payments:',db.prepare('SELECT COUNT(*) n FROM payments').get().n))"
```

The counts you printed in step 26/27 are still there → the database survived
`down`/`up` because it lives in the persistent volume, not in the containers.

## Step 29 — Create real Treasurer accounts

As the Admin, log in at `https://<domain>` → **Manage Users** → **Add User** →
create one account per committee member (unique email, own password, role
**Treasurer**, active). No shared accounts.

(Alternative, if you prefer the command line:

```bash
docker compose exec -T app node scripts/create-user.mjs --name "Treasurer Name" --email treasurer@example.org --role treasurer
```

— but the UI is easier.)

## Step 30 — Final production verification

- [ ] Login as the real Admin and as a Treasurer
- [ ] Add a real household → appears on Android app instantly
- [ ] Record Cash, UPI, and Split collections → totals correct on Dashboard
- [ ] Monthly + Annual reports and PDFs generate and download
- [ ] Duplicate payment for the same house+month is blocked
- [ ] Log out, log in as a Treasurer → Admin screens are not visible (403 on
      direct API calls)
- [ ] Reboot the VPS (`reboot`), wait a minute, reopen `https://<domain>` →
      everything is back with the same data

---

## Security summary

- **SSH key only** — no typed passwords; your private key never leaves your PC.
- **Firewall** — open only 22 (SSH), 80 (HTTP redirect), 443 (HTTPS). Easiest:
  in the DigitalOcean control panel create a **Cloud Firewall** with those
  three inbound rules and apply it to the droplet. (Or on the server:
  `ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable`.)
- **HTTPS everywhere** — Caddy terminates TLS; plain HTTP redirects to HTTPS;
  session cookies are `HttpOnly; Secure; SameSite=Lax`.
- **Production mode** — `NODE_ENV=production` everywhere (Secure cookies,
  trust-proxy, demo gates).
- **No demo credentials** — never created on the server; logins rejected.
- **No sample data** — never seeded; reset disabled (403).
- **No secrets in Git** — `.env` is excluded (`.dockerignore` + not committed);
  `.env` permissions are `600` on the server.
- **Admin password** — strong and unique, never printed anywhere; the
  bootstrap variables are removed after first start.

## What is still NOT done (until you run it)

Deployment is **not complete** until the actual public URL
`https://<domain>` responds over HTTPS and passes step 24 on your phone. This
guide is the procedure; the final "deployed" confirmation is the checklist in
step 30. When you have run it, that's the moment the temporary
`*.trycloudflare.com` tunnel can be retired and the app is finally independent
of your laptop.
