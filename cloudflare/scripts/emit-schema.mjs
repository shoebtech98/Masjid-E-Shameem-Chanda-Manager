/*
 * Regenerate src/schema.sql from the SCHEMA constant in src/db.js.
 * db.js is the single source of truth for the DDL; this keeps the CLI-applied
 * file (wrangler d1 execute --file src/schema.sql) from ever drifting.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbSrc = path.join(__dirname, '..', 'src', 'db.js');
const schemaFile = path.join(__dirname, '..', 'src', 'schema.sql');

const src = readFileSync(dbSrc, 'utf8');
const m = src.match(/export const SCHEMA = `([\s\S]*?)`;/);
if (!m) {
  console.error('emit-schema.mjs: could not find "export const SCHEMA = `...`" in src/db.js');
  process.exit(1);
}

const header = `-- Masjid E Shameem – Chanda Manager · D1 schema
-- GENERATED from src/db.js (export const SCHEMA) — do not edit by hand.
-- Regenerate with:  npm run emit-schema
`;
writeFileSync(schemaFile, header + m[1].trim() + '\n');
console.log(`schema.sql regenerated from db.js (${m[1].length} chars of DDL)`);
