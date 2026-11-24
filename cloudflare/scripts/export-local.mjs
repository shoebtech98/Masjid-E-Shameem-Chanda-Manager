/*
 * Export a local SQLite database to a D1-importable SQL dump.
 *
 * Used for:
 *   - fixtures: dump the reference app's throwaway DB so the Cloudflare
 *     build can be tested on an IDENTICAL dataset (qa-crosscheck.mjs)
 *   - real-data migration: dump the production data/chanda.db into
 *     schema+data .sql, then `wrangler d1 execute <db> --file dump.sql`
 *
 * The dump is FK-safe: it writes rows in dependency order (users,
 * households, payments, sessions, audit_log) and disables FK checks around
 * the load so D1 accepts it exactly like SQLite would.
 *
 * Usage:
 *   node scripts/export-local.mjs [--db <path>] [--out <path>]
 * Defaults: --db ../data/chanda.db (the reference app's live DB), --out stdout.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_DB = path.join(ROOT, '..', 'data', 'chanda.db'); // reference app's live DB

const TABLES = ['users', 'households', 'payments', 'sessions', 'audit_log'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') out.db = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}

const esc = (s) => String(s).replace(/'/g, "''");
const sqlStr = (v) => (v === null || v === undefined ? 'NULL' : `'${esc(v)}'`);
const sqlVal = (v) => (typeof v === 'number' ? String(v) : sqlStr(v));

function dumpTable(db, table) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  const lines = [];
  for (const row of rows) {
    const values = cols.map((c) => sqlVal(row[c])).join(', ');
    lines.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values});`);
  }
  return lines;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.db ? path.resolve(args.db) : DEFAULT_DB;
  const outPath = args.out ? path.resolve(args.out) : null;

  if (!dbPath.endsWith('.db') && !dbPath.endsWith('.sqlite')) {
    console.error(`✗ Expected a SQLite file: ${dbPath}`);
    process.exit(1);
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    console.error(`✗ Cannot open ${dbPath}: ${err.message}`);
    process.exit(1);
  }

  // Schema (from the reference schema.sql if present, else the embedded DDL).
  const schemaCandidates = [
    path.join(__dirname, '..', 'src', 'schema.sql'),
    path.join(ROOT, '..', 'src', 'schema.sql'),
  ];
  let schema = '';
  for (const f of schemaCandidates) {
    try { schema = readFileSync(f, 'utf8'); break; } catch { /* try next */ }
  }
  if (!schema.trim()) {
    console.error('✗ No schema.sql found to prefix the dump.');
    process.exit(1);
  }

  const lines = [];
  lines.push('PRAGMA foreign_keys = OFF;');
  lines.push(schema.trim());
  for (const t of TABLES) {
    const ins = dumpTable(db, t);
    if (ins.length) lines.push(...ins);
    lines.push('');
  }
  lines.push('PRAGMA foreign_keys = ON;');
  const sql = lines.join('\n');

  const counts = {};
  for (const t of TABLES) counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  db.close();

  if (outPath) {
    // Never overwrite an existing dump silently.
    if (existsSync(outPath)) {
      console.error(`✗ Refusing to overwrite ${outPath} — choose a different --out.`);
      process.exit(1);
    }
    writeFileSync(outPath, sql);
    console.log(`✓ Dump written: ${outPath} (${Object.entries(counts).map(([t, c]) => `${t}=${c}`).join(', ')})`);
  } else {
    process.stdout.write(sql);
  }
}

main();
