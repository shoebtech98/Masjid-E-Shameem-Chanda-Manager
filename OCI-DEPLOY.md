# Masjid E Shameem — OCI Always Free Deployment (Windows walkthrough)

Deploy the app permanently on **Oracle Cloud Infrastructure (OCI) Always Free**
— zero recurring hosting cost, Docker + Caddy + a persistent SQLite database
on block storage.

```
Android / Desktop PWA
        │  HTTPS (Caddy, Let's Encrypt)
        ▼
OCI Always Free VM (VM.Standard.A1.Flex — 1 OCPU / 6 GB, Ubuntu 24.04)
        │  Docker + Docker Compose
        ▼
Persistent block volume (/opt/masjid-data)  ──►  daily verified backups
        │                                           (VACUUM INTO)
        ▼
off-box copy: your PC via scp, or OCI Object Storage (free)
```

Commands are labelled **WINDOWS COMMAND** (run in PowerShell on your PC) and
**ORACLE VPS COMMAND** (run after SSH-ing into the VM).

Placeholders: `<VPS-IP>` (the VM's public IP), `<domain>` (your DuckDNS name or
real domain), `<YOUR-ADMIN-PASSWORD>` (a strong password you choose),
`<you@example.org>` (your email).

---

## ⚠ Cost verification first — read this before anything else

**The good news:** the exact resources this deployment needs **are** inside
Oracle's Always Free allowance as of August 2026:

| Resource | This deployment uses | Always Free allowance | Within? |
|---|---|---|---|
| Compute (A1.Flex, Arm) | **1 VM, 1 OCPU, 6 GB RAM, 24/7** = 730 OCPU-h & 4,380 GB-h per month | **1,500 OCPU-h + 9,000 GB-h per month** (~2 OCPU / 12 GB total) | ✅ wide margin |
| Block volume (boot) | 47 GB | 200 GB total block storage (all boot + data volumes) | ✅ |
| Block volume (data) | 50 GB (see step 12) | included in the 200 GB pool | ✅ |
| Object Storage | ~1 GB of backups | **10 GB Standard + 10 GB Infrequent + 10 GB Archive**, 50,000 API requests/month | ✅ |
| Public IPv4 | 1 (reserved) | free ("There is no charge to use this feature") | ✅ |
| Data egress | tiny | **10 TB/month free** | ✅ |
| TLS certs | Let's Encrypt via Caddy | free | ✅ |

**What you must know before trusting "free":**

1. **The rules changed in 2026.** Oracle halved the A1 allowance (from
   4 OCPU/24 GB to ~2 OCPU/12 GB) with little notice, and on **August 18,
   2026** begins enforcing the new limits (instances above them get
   stopped/resized). Our 1 OCPU/6 GB plan is compliant under both the old and
   new rules.
2. **Idle instances can be reclaimed.** Oracle "may reclaim" Always Free
   compute instances that, over any 7-day period, stay under **20% CPU,
   20% network, and (A1 only) 20% memory utilization**. A masjid app with
   light traffic could fall under that. See the mitigation in the Reliability
   section (step 21) — and note that even if the VM is reclaimed, **the data
   block volume and your backups survive**, so recovery is a re-provision.
3. **Signup requires a credit card** for identity verification (a small
   temporary hold, refunded). New accounts get **$300 trial credits valid for
   30 days**; after they expire, Always Free resources continue to be free.
   Oracle's own wording: *"Oracle doesn't charge for Always Free resources
   after you upgrade [to PAYG], and will only charge you for resource usage
   above the Always Free limits."* In practice you may need to upgrade the
   account to **Pay As You Go** to keep Always Free resources available — PAYG
   with **zero** usage above the limits costs **$0**.
4. **Always Free resources exist only in your Home Region** (chosen at signup,
   cannot be changed later) — plan for this in step 2.
5. **"Out of host capacity"** is common for A1 free shapes in busy regions —
   troubleshooting in step 3.

**Conclusion:** the deployment itself is genuinely free *within the current
allocation*, but it is not contractually guaranteed forever — Oracle can change
limits and reclaim idle instances. Treat the free tier as "free, with
reliability caveats", protect the data with the block volume + backups, and
budget (nothing) accordingly. The only recurring cost you may choose to incur
is **a domain (~$10–15/year)** for a permanent branded URL — a free DuckDNS
name works but is explicitly temporary (step 14).

---

## Step 1 — Create the Oracle Cloud account

1. Go to <https://signup.oraclecloud.com> → **Start for Free**
2. Enter country, name, email (not a shared/junk address — Oracle sends the
   sign-in link here)
3. Verify the email and set a password
4. **Add a credit/debit card** — required for identity verification. A small
   temporary hold appears and is refunded. Nothing is charged if you stay
   within Always Free.
5. Confirm and finish the wizard. Sign-in takes ~5–15 minutes to provision.

## Step 2 — Choose the Home Region (important!)

You'll be asked for a **Home Region** at first login. **This choice is
permanent** and Always Free resources must live there. Pick the region closest
to the masjid's users — for India, **Mumbai** (or Hyderabad/Singapore).

## Step 3 — Create the Always Free VM

1. Console → ☰ menu → **Compute → Instances → Create instance**
2. Name: `masjid-shameem`
3. **Placement**: leave default (a region with an Always Free badge)
4. **Image**: **Canonical Ubuntu 24.04 LTS** — it must show the
   **"Always Free Eligible"** badge (step 4)
5. **Shape**: click **Change shape** → select **VM.Standard.A1.Flex** (Arm)
   with the Always Free badge → set **OCPUs: 1, Memory: 6 GB**
6. **Networking**: default VCN/subnet is fine
7. **Add SSH keys**: **Paste public keys** — paste the key from step 5
8. **Boot volume**: leave default (47 GB, part of the 200 GB pool)
9. Click **Create**

> **"Out of host capacity"?** A1 free capacity is often exhausted. Try:
> another **Availability Domain**, wait and retry, or create the instance and
> then use the **Start** action later — capacity frees up continuously. (The
> free A1 instances are sometimes temporarily unavailable in popular regions;
> the E2.1.Micro x86 shape is the fallback, but its 1 GB RAM is tight for
> Docker + Node — the A1 is strongly preferred.)

## Step 4 — Select Ubuntu

Covered above: **Canonical Ubuntu 24.04 LTS** (or 22.04 LTS — both work with
the A1 shape). Only images labelled **Always Free Eligible** avoid licensing
fees.

## Step 5 — Configure the SSH key (on your Windows PC)

**WINDOWS COMMAND** (PowerShell):

```powershell
ssh-keygen -t ed25519 -C "masjid-oci"
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

Copy the whole printed line (`ssh-ed25519 AAAA… masjid-oci`) and paste it in
the VM creation screen (step 3.7). Your private key stays on your PC — it is
your only way in.

## Step 6 — Find the public IP

In **Compute → Instances → masjid-shameem**, the **Public IP** is shown.
Copy it as `<VPS-IP>`.

> **Make it permanent (recommended, free):** the default public IP is
> *ephemeral* and can change across stops/restarts. Create a **Reserved Public
> IP** (☰ → **Networking → IP management → Reserved public IPs → Reserve**,
> then **Attach** to the instance). OCI does not charge for reserved public
> IPs, and it survives restarts.

## Step 7 — Configure the firewall (security lists)

OCI controls traffic with **Security Lists** on the subnet (the VM's OS
firewall is not the gate here).

1. ☰ → **Networking → Virtual cloud networks** → your VCN → **Security Lists**
   → the default list → **Add Ingress Rules**
2. Add these inbound rules (source `0.0.0.0/0`):

| Direction | Source | Protocol | Port | Purpose |
|---|---|---|---|---|
| Ingress | 0.0.0.0/0 | TCP | **80** | HTTP → HTTPS redirect + certificate issuance |
| Ingress | 0.0.0.0/0 | TCP | **443** | HTTPS (the app) |
| Ingress | *your home IP only* | TCP | **22** | SSH administration (best practice: your home IP instead of 0.0.0.0/0) |

No other ports are needed — the SQLite database is a local file (there is no
database port to expose), and the app container is not published to the host.

## Step 8 — Connect from Windows PowerShell

**WINDOWS COMMAND:**

```powershell
ssh ubuntu@<VPS-IP>
```

Note the user is **`ubuntu`** (OCI's Ubuntu images use the `ubuntu` user with
passwordless `sudo` — not `root`). Type `yes` to accept the fingerprint on the
first connection.

**Everything below runs on the VM — label it ORACLE VPS COMMAND.**

## Step 9 — Install Docker and Docker Compose

**ORACLE VPS COMMAND:**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

Log out and back in (so the `docker` group applies), then verify:

```bash
docker --version && docker compose version
```

## Step 10 — Upload the project from Windows

**WINDOWS COMMAND** (PowerShell):

```powershell
cd "C:\Users\Mohd Shoeb\Desktop\Chanda App"
tar --exclude=node_modules --exclude=data --exclude=.git -czf "$env:TEMP\masjid-oci.tgz" .
scp "$env:TEMP\masjid-oci.tgz" ubuntu@<VPS-IP>:/tmp/
```

**ORACLE VPS COMMAND:**

```bash
sudo mkdir -p /opt/masjid-shameem
sudo chown $USER /opt/masjid-shameem
cd /opt/masjid-shameem
tar -xzf /tmp/masjid-oci.tgz
rm /tmp/masjid-oci.tgz
ls
```

You should see `Dockerfile`, `docker-compose.yml`, `docker-compose.oci.yml`,
`Caddyfile`, `OCI-DEPLOY.md`, `server.js`, `public/`, etc. — and **no**
`data/` or `node_modules/` (the production database starts clean).

## Step 11 — Configure `.env`

**ORACLE VPS COMMAND:**

```bash
cd /opt/masjid-shameem
cp .env.example .env
sudo apt install -y nano   # only if "nano: command not found"
nano .env
```

- Leave `NODE_ENV=production`, `PORT=3000` as-is.
- Leave `DB_PATH` commented (the compose files set it to `/app/data/chanda.db`,
  which step 12 maps to the block volume).
- Set the two Initial Admin lines (step 19):
  `INITIAL_ADMIN_EMAIL=<you@example.org>` and
  `INITIAL_ADMIN_PASSWORD=<YOUR-ADMIN-PASSWORD>`.
- Do **not** enable `SEED_DEMO_USERS`, `SEED_SAMPLE_DATA`, or `DEMO_MODE`.

Then lock it down:

```bash
chmod 600 .env
```

## Step 12 — Configure persistent storage (the critical step)

The SQLite file must live on a **block volume**, not inside the container or on
the boot volume alone.

**A. Create and attach a 50 GB block volume (console):**

1. ☰ → **Storage → Block Storage → Block Volumes → Create Block Volume**
   - Name: `masjid-data`, Size: **50 GB** (within the 200 GB Always Free pool)
   - Same **Availability Domain** as the VM
2. Open the volume → **Attach** → choose the instance → attach
   (paravirtualized attachment, defaults are fine)

**B. Format and mount it on the VM (permanent mount):**

**ORACLE VPS COMMAND:**

```bash
lsblk                              # find the new disk, e.g. /dev/sdb
sudo mkfs.ext4 /dev/sdb            # ONLY once — formats the volume
sudo mkdir -p /opt/masjid-data
sudo mount /dev/sdb /opt/masjid-data
sudo blkid /dev/sdb                # copy the UUID=... value
```

Make the mount permanent across reboots (edit `/etc/fstab`):

```bash
sudo nano /etc/fstab
```

Add one line (replace the UUID):

```
UUID=<your-uuid>  /opt/masjid-data  ext4  defaults,noatime  0  2
```

Verify it mounts on boot:

```bash
sudo umount /opt/masjid-data && sudo mount -a && df -h /opt/masjid-data
```

**C. Point the container at it.** The repo's `docker-compose.oci.yml`
overrides the volume mapping:

```yaml
services:
  app:
    volumes:
      - /opt/masjid-data:/app/data
```

So inside the container `DB_PATH=/app/data/chanda.db` is really
`/opt/masjid-data/chanda.db` on the block volume — **survives Docker restarts,
`docker compose down`, redeploys, and VM reboots**, and is separate from the
container filesystem and the image (`.dockerignore` excludes `data/`, so no
database is ever baked into the image).

## Step 13 — Configure Caddy

**ORACLE VPS COMMAND:**

```bash
cd /opt/masjid-shameem
nano Caddyfile
```

Replace `masjid.example.org` with your address — the **same** one you set up
in step 14:

```
<domain> {
    encode gzip
    reverse_proxy app:3000
}
```

Caddy automatically obtains and renews a **Let's Encrypt** certificate for it
(needs ports 80 + 443 open — step 7), redirects HTTP → HTTPS, and terminates
TLS in front of Node, so session cookies are issued
`HttpOnly; Secure; SameSite=Lax`.

## Step 14 — Configure domain / DNS

**Permanent (recommended, ~$10–15/year):** register a real domain (Porkbun /
Namecheap / Cloudflare Registrar) and add an **A record**:

| Type | Name | Value |
|---|---|---|
| `A` | `@` | `<VPS-IP>` |

(or `A` `chanda` → `<VPS-IP>` if you prefer `chanda.<domain>` — then use that
in the Caddyfile.)

**Temporary HTTPS without a domain (free): DuckDNS.** Because Caddy needs a
real domain to get a Let's Encrypt certificate, the simplest free temporary
address is a **DuckDNS subdomain**:

1. Sign in at <https://www.duckdns.org> (any free account)
2. Create a name, e.g. `masjid-shameem`
3. Set its **IP** field to `<VPS-IP>` (a Reserved IP from step 6 keeps it
   stable) and save
4. Use `masjid-shameem.duckdns.org` as `<domain>` in the Caddyfile

> **Clearly temporary:** the DuckDNS name is not yours permanently, DuckDNS is
> a volunteer service, and `.duckdns.org` is not a professional address. Use it
> to get HTTPS + PWA install working now; switch to a real domain later by
> changing the Caddyfile line and recreating Caddy (`docker compose up -d
> caddy`) — the certificate renews automatically. The app and data are
> untouched by the change.

## Step 15 — Start Docker Compose

**ORACLE VPS COMMAND:**

```bash
cd /opt/masjid-shameem
docker compose -f docker-compose.yml -f docker-compose.oci.yml up -d --build
docker compose ps
docker compose logs app --tail 30
```

You should see both `app` and `caddy` running, and (first boot) the initial
Admin creation message (step 19). **Immediately after that**, remove the two
`INITIAL_ADMIN_*` lines from `.env` and restart:

```bash
nano .env            # delete the two INITIAL_ADMIN_* lines
docker compose -f docker-compose.yml -f docker-compose.oci.yml up -d
```

## Step 16 — Verify `/api/health`

**ORACLE VPS COMMAND:**

```bash
curl -s https://<domain>/api/health
```

Expected: `{"ok":true,"name":"Masjid E Shameem – Chanda Manager","version":"1.0.0","uptime":…,"db":"ok"}`

(`db:"ok"` means the block-volume database is reachable; if the DB is ever
unreachable the endpoint returns HTTP 503 with `"db":"error"` — no secrets.)

## Step 17 — Verify HTTPS

- Open `https://<domain>` in a browser on Windows → valid padlock, and
  `http://<domain>` redirects to HTTPS.
- **ORACLE VPS COMMAND** to inspect the certificate:

```bash
docker compose logs caddy --tail 30 | grep -i certificate
echo | openssl s_client -connect <domain>:443 -servername <domain> 2>/dev/null | grep subject=
```

If the certificate fails to issue, the DNS record from step 14 isn't resolving
yet or ports 80/443 are blocked — Caddy retries automatically.

## Step 18 — Verify PWA

- `https://<domain>/manifest.webmanifest` → `application/manifest+json`, name
  **"Masjid E Shameem – Chanda Manager"**, `display: standalone`
- `https://<domain>/sw.js` → loads, contains `APP_VERSION`; `/api/` requests
  are **never** intercepted or cached
- Chrome on Android will offer **Install app / Add to Home screen** (step 22)

## Step 19 — Create the real Admin (no demo accounts)

- Covered in step 11/15: on the **first** boot, with an empty database,
  `INITIAL_ADMIN_EMAIL` + `INITIAL_ADMIN_PASSWORD` create the first real Admin
  **once**, then you remove the variables (step 15). Demo accounts are never
  created in production (logins return 401), sample data is never seeded, and
  the **Reset Sample Data** endpoint is disabled (403) and hidden from the UI.
- Verify: `curl -s https://<domain>/api/config` →
  `{"demoUsers":false,"demoMode":false}`
- Afterwards, log in as the Admin at `https://<domain>` and create individual
  **Treasurer** accounts in **Manage Users** (unique email, own password,
  role, active status). No shared logins.

## Step 20 — Configure backups

The project's `npm run backup` uses **`VACUUM INTO`** (a consistent snapshot
even while the app is running), **verifies each file** (`PRAGMA integrity_check`
+ row counts) before reporting success, uses timestamped names that never
overwrite, and stores to `/app/data/backups/` (= `/opt/masjid-data/backups/` on
the block volume).

**Daily backup + weekly off-box copy (cron):**

**ORACLE VPS COMMAND:**

```bash
crontab -e
```

Add (backups run inside the container — the VM host has no Node.js):

```
# Daily 23:00 — verified backup onto the data block volume
0 23 * * * cd /opt/masjid-shameem && docker compose -f docker-compose.yml -f docker-compose.oci.yml exec -T app node scripts/backup.mjs >> /var/log/masjid-backup.log 2>&1
# Weekly 03:10 — bundle backups off the volume to the host disk
10 3 * * 1 tar -czf /home/ubuntu/masjid-backups-$(date +\%F).tgz -C /opt/masjid-data backups
```

**Free off-box copies (choose one):**

- **Simplest — pull to your PC weekly.** **WINDOWS COMMAND:**

  ```powershell
  scp ubuntu@<VPS-IP>:/home/ubuntu/masjid-backups-*.tgz "C:\Users\<you>\Documents\MasjidBackups\"
  ```

- **Truly off-site — OCI Object Storage (free 10 GB Standard).** Optional and
  more advanced (installs the OCI CLI and sets up an API key in the console),
  but the bucket is free and separate from the VM entirely:

  ```bash
  bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"
  oci setup config          # follow the prompts; create an API key in Console → User → API keys
  oci os bucket create --name masjid-backups
  oci os object put --bucket-name masjid-backups --file /home/ubuntu/masjid-backups-$(date +%F).tgz
  ```

  Add the `oci os object put` line to the weekly cron instead of (or in
  addition to) the tar. 50,000 free API requests/month is plenty for daily
  uploads. If the free-tier rules change or you ever move platforms, download
  the objects back with `oci os object get`.

**Recommended free layout:** daily verified backup on the block volume
(1-line integrity-checked) **+** weekly copy to your PC or Object Storage
(off-site). A backup only counts once it passed the script's verification — an
unverifiable file is deleted by the script with a non-zero exit.

## Step 21 — Reboot the VM and verify database persistence

**ORACLE VPS COMMAND:**

```bash
sudo reboot
```

Wait ~1–2 minutes, reconnect, then:

```bash
docker compose -f docker-compose.yml -f docker-compose.oci.yml ps
curl -s https://<domain>/api/health
docker compose -f docker-compose.yml -f docker-compose.oci.yml exec app node -e "import('./db.js').then(({db})=>console.log('households:',db.prepare('SELECT COUNT(*) n FROM households').get().n))"
```

Same counts as before the reboot → the block volume mount worked (fstab line)
and the database survived. (Also confirm `df -h /opt/masjid-data` is mounted.)

**Reliability note — the idle-reclaim risk (be honest with yourself):** Oracle
may reclaim a free VM that is idle for 7 days (CPU/network/memory under 20%).
A lightly used masjid app could trigger this. Mitigations:

- **Keep the app in real use** — committee members logging in daily naturally
  keeps activity up.
- Add a small keep-alive (cheap insurance, does not fix a truly idle box):

  ```bash
  crontab -e
  # ping the app every 5 minutes
  */5 * * * * curl -s -o /dev/null https://<domain>/api/health
  ```

- **The important guarantee is the DATA, not the VM.** Even if the instance is
  reclaimed, the **block volume survives** (it is not deleted with the
  instance) and your off-box backups exist. Recovery = re-provision a new
  Always Free VM (steps 3–9), re-attach the volume, re-mount, and
  `docker compose up` — the DB is intact. See Recovery below.

## Step 22 — Install the PWA on Android

1. Open **Chrome** on the Android phone → `https://<domain>`
2. Log in with the Admin account
3. Chrome **⋮ menu → Install app / Add to Home screen** → confirm
4. Launch the installed **Masjid E Shameem** — it opens full-screen (standalone)
5. Run a full test: Add Household → Add Collection (Cash / UPI / Split) →
   Search → History → Monthly + Annual reports → PDF → **Share**
6. Records entered on the phone appear on the desktop instantly (one database)
7. Turn off the phone's Wi-Fi → **NO INTERNET CONNECTION** banner appears and
   saving is blocked — no false "saved" message; payment success only ever
   shows after the backend confirms

---

## Recovery procedure (VM failure / re-provision)

1. **Database backup** — `docker compose exec -T app node scripts/backup.mjs`
   (verified `VACUUM INTO` snapshot on the block volume).
2. **Backup verification** — the script refuses success unless the file opens,
   passes `integrity_check`, and matches live row counts. Spot-check:
   `docker compose exec -T app node scripts/backup.mjs` and read the ✓ line.
3. **VM failure scenario** — the instance is gone/reclaimed. The 50 GB block
   volume and your off-box backups still exist.
4. **Restore the database** — either re-attach the block volume (Storage →
   Block Volumes → attach to the new instance, mount as in step 12) or upload
   a backup file and restore it. **Important:** the restore command must use
   the same `-f docker-compose.oci.yml` override so `/app/data` maps to the
   block volume (without it, Docker would mount the default named volume and
   the restore would land in the wrong place):

   ```bash
   # if the app is currently running on this instance, stop it first:
   docker compose -f docker-compose.yml -f docker-compose.oci.yml stop app
   # restore from a backup file on the block volume:
   docker compose -f docker-compose.yml -f docker-compose.oci.yml run --rm app \
     node scripts/restore.mjs /app/data/backups/Masjid_E_Shameem_backup_<timestamp>.db
   docker compose -f docker-compose.yml -f docker-compose.oci.yml start app
   ```

   (the script validates the file, asks you to type `RESTORE`, replaces the
   live DB, removes stale WAL sidecars, and re-verifies).
5. **Restart the application** — `docker compose up -d` (or the full
   `-f docker-compose.yml -f docker-compose.oci.yml up -d --build`).
6. **Verify users** — log in as the Admin; Manage Users lists every account.
7. **Verify households** — household list matches pre-failure.
8. **Verify payments** — payment history / dashboard totals match.
9. **Verify reports/PDF totals** — Monthly + Annual reports and PDFs reconcile
   against the pre-failure numbers (the PDFs are computed from the restored
   tables, so matching totals prove full recovery).

---

## Security checklist

- [ ] SSH **key authentication** only (no password login); private key never
      leaves your PC
- [ ] Security list: only **22** (SSH, ideally your IP), **80**, **443**
      inbound; no database port exposed (SQLite is a local file)
- [ ] **HTTPS** via Caddy + Let's Encrypt; HTTP redirects to HTTPS
- [ ] Cookies: `HttpOnly; Secure; SameSite=Lax` (production mode)
- [ ] `NODE_ENV=production` everywhere; demo credentials **never** created;
      sample data **never** seeded; reset endpoint **403** + hidden
- [ ] No secrets in the Docker image (`.dockerignore` excludes `.env` and
      `data/`), `.env` is `chmod 600` and not committed to Git
- [ ] Real Admin with a strong, unique password; individual Treasurer accounts

## Final deployment checklist

- [ ] VM running (A1.Flex 1 OCPU / 6 GB, Ubuntu 24.04)
- [ ] Reserved public IP attached
- [ ] Security lists: 22/80/443 open
- [ ] Block volume mounted at `/opt/masjid-data` (fstab) — survives reboot
- [ ] DNS: DuckDNS (temporary) or real A record → resolves
- [ ] HTTPS works, certificate valid
- [ ] `/api/health` → `ok:true, db:"ok"`
- [ ] `/api/config` → `demoUsers:false, demoMode:false`
- [ ] Real Admin created; `INITIAL_ADMIN_*` removed
- [ ] PWA installs on Android; offline save blocked
- [ ] Daily verified backup cron installed; first backup passes verification
- [ ] Off-box copy (PC via scp, or Object Storage) tested once
- [ ] Reboot test passed (data persists)
- [ ] Recovery procedure understood (volume re-attach + restore)

> **Deployment is not complete** until `https://<domain>` responds over HTTPS
> and the checklist above passes from a real phone and desktop. This guide is
> the plan; the checklist is the proof.
