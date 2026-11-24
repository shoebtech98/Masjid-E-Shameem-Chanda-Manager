/*
 * Restore a backup over the live Masjid E Shameem database.
 *
 * The application MUST be stopped before running this (the live file is
 * replaced wholesale). On Windows the copy fails if the app still holds the
 * file open, which acts as a safety net.
 *
 * Safety:
 *   - The backup file is validated BEFORE anything is touched: it must open,
 *     pass `PRAGMA integrity_check`, and contain the expected tables.
 *   - Requires typing RESTORE to confirm.
 *   - After restoring, the new live database is re-opened and re-verified
 *     (integrity + row counts), and stale WAL sidecar files are removed.
 *
 * Usage:
 *   npm run restore -- <path-to-backup.db>
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

try { loadEnvFile(); } catch (e) { if (e && e.code !== 'ENOENT') throw e; }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'chanda.db');

const REQUIRED_TABLES = ['users', 'households', 'payments', 'audit_log'];

function inspectDb(file) {
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check;
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all().map((r) => r.name);
    const counts = {};
    for (const t of REQUIRED_TABLES) {
      if (tables.includes(t)) counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    }
    db.close();
    return { integrity, tables, counts };
  } catch {
    return null;
  }
}

async function confirm(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (a) => { rl.close(); resolve(a.trim()); }));
}

async function main() {
  const backupArg = process.argv[2];
  if (!backupArg) {
    console.error('Usage: npm run restore -- <path-to-backup.db>');
    process.exit(1);
  }
  const backupFile = path.resolve(backupArg);
  if (!fs.existsSync(backupFile)) {
    console.error(`✗ Backup file not found: ${backupFile}`);
    process.exit(1);
  }
  if (path.resolve(backupFile) === path.resolve(DB_PATH)) {
    console.error('✗ Refusing to restore a file onto itself.');
    process.exit(1);
  }

  // Validate the backup BEFORE touching the live database.
  const info = inspectDb(backupFile);
  if (!info || info.integrity !== 'ok') {
    console.error(`✗ "${backupArg}" is not a valid SQLite backup (failed integrity_check).`);
    process.exit(1);
  }
  const missing = REQUIRED_TABLES.filter((t) => !info.tables.includes(t));
  if (missing.length) {
    console.error(`✗ "${backupArg}" is missing required tables: ${missing.join(', ')} — not a Masjid backup.`);
    process.exit(1);
  }

  const rowSummary = REQUIRED_TABLES.map((t) => `${t}=${info.counts[t] ?? 0}`).join(', ');
  console.log(`Backup validated: ${backupFile}`);
  console.log(`  integrity_check: ok · rows: ${rowSummary}`);
  console.log(`This will REPLACE the live database at: ${DB_PATH}`);
  console.log('Stop the application first. This cannot be undone.');

  const answer = await confirm('Type RESTORE to continue: ');
  if (answer !== 'RESTORE') {
    console.log('Restore cancelled.');
    process.exit(0);
  }

  try {
    fs.copyFileSync(backupFile, DB_PATH);
  } catch (err) {
    console.error(`✗ Could not write the live database (is the application still running?): ${err.message}`);
    process.exit(1);
  }

  // Remove stale WAL sidecar files so the restored DB starts clean.
  for (const suffix of ['-wal', '-shm']) {
    const side = `${DB_PATH}${suffix}`;
    if (fs.existsSync(side)) {
      try { fs.unlinkSync(side); } catch { /* best effort */ }
    }
  }

  // Verify the restored database.
  const restored = inspectDb(DB_PATH);
  if (!restored || restored.integrity !== 'ok') {
    console.error('✗ Restore completed but the live database FAILED integrity_check. Investigate immediately.');
    process.exit(1);
  }
  const restoredRows = REQUIRED_TABLES.map((t) => `${t}=${restored.counts[t] ?? 0}`).join(', ');
  console.log(`✓ Restore complete and verified: integrity_check ok · rows: ${restoredRows}`);
  console.log('Start the application and verify users, households, payments, and reports.');
}

main();
