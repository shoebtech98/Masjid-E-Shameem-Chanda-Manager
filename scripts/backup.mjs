/*
 * Safe backup for the Masjid E Shameem SQLite database.
 *
 * - Uses SQLite's `VACUUM INTO`, which produces a consistent snapshot even
 *   while the application is running and writing (WAL mode) — never a raw
 *   file copy of a live database.
 * - Timestamped filename (never overwrites an existing backup):
 *     Masjid_E_Shameem_backup_2026-08-16_230012.db
 * - Stored in BACKUP_DIR (default ./data/backups) — separate from the live
 *   database file.
 * - VERIFIES every backup before reporting success: the file must open,
 *   pass `PRAGMA integrity_check`, and contain the expected tables with the
 *   same row counts as the live database. A backup that fails verification
 *   is deleted and the script exits non-zero — a file existing is not a
 *   backup.
 *
 * Usage:
 *   npm run backup
 *   BACKUP_DIR=/mnt/backups npm run backup
 * Cron example (nightly 02:00):
 *   0 2 * * * cd /path/to/app && npm run backup >> /var/log/masjid-backup.log 2>&1
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

try { loadEnvFile(); } catch (e) { if (e && e.code !== 'ENOENT') throw e; }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'chanda.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'data', 'backups');

const TABLES = ['users', 'households', 'payments', 'sessions', 'audit_log'];

const pad = (n) => String(n).padStart(2, '0');
function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function tableCounts(db) {
  const out = {};
  for (const t of TABLES) {
    try { out[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c; } catch { out[t] = null; }
  }
  return out;
}

/** Opens a DB read-only and returns integrity + table counts, or null. */
function inspectDb(file) {
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check;
    const counts = tableCounts(db);
    db.close();
    return { integrity, counts };
  } catch {
    return null;
  }
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`✗ Live database not found: ${DB_PATH}`);
    process.exit(1);
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Live reference counts (fresh read-only connection — safe alongside WAL).
  const live = inspectDb(DB_PATH);
  if (!live || live.integrity !== 'ok') {
    console.error(`✗ Live database failed integrity_check — fix it before backing up.`);
    process.exit(1);
  }

  // Unique, timestamped filename — never overwrite an existing backup.
  let file = path.join(BACKUP_DIR, `Masjid_E_Shameem_backup_${timestamp()}.db`);
  let n = 2;
  while (fs.existsSync(file)) {
    file = path.join(BACKUP_DIR, `Masjid_E_Shameem_backup_${timestamp()}-${n}.db`);
    n += 1;
  }

  // Consistent snapshot via VACUUM INTO (safe while the app is running).
  try {
    const src = new DatabaseSync(DB_PATH);
    src.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    src.close();
  } catch (err) {
    console.error(`✗ Backup failed: ${err.message}`);
    process.exit(1);
  }

  // Verification — a file existing is not a backup.
  const bk = inspectDb(file);
  if (!bk || bk.integrity !== 'ok') {
    fs.unlinkSync(file);
    console.error(`✗ Backup failed verification (integrity_check) — file removed.`);
    process.exit(1);
  }
  const mismatches = TABLES.filter((t) => live.counts[t] !== bk.counts[t]);
  if (mismatches.length > 0) {
    fs.unlinkSync(file);
    console.error(`✗ Backup failed verification (row mismatch on ${mismatches.join(', ')}) — file removed.`);
    process.exit(1);
  }

  const rows = Object.entries(bk.counts).map(([t, c]) => `${t}=${c}`).join(', ');
  console.log(`✓ Backup created and verified: ${file}`);
  console.log(`  integrity_check: ok · rows: ${rows}`);
}

main();
