// D1 database layer.
//
// Wraps the D1 binding behind the same API the reference app uses
// (db.prepare(sql).get/all/run with positional params), so ported routes stay
// mechanically close to the original. `run()` maps D1's meta.last_row_id back
// to the reference `lastInsertRowid` shape. Multi-statement writes use
// batch() (D1 has no interactive BEGIN/COMMIT).
//
// SCHEMA is the single source of truth for the schema; scripts/emit-schema.mjs
// regenerates src/schema.sql from it so the CLI-applied file can never drift.
import { hashPassword } from './password.js';
import { isoNow } from './time.js';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'treasurer',
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS households (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  house_no       TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  phone          TEXT,
  monthly_amount INTEGER NOT NULL CHECK (monthly_amount > 0),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  month         INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year          INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  payment_mode  TEXT NOT NULL CHECK (payment_mode IN ('cash','upi','split')),
  cash_amount   INTEGER NOT NULL DEFAULT 0 CHECK (cash_amount >= 0),
  upi_amount    INTEGER NOT NULL DEFAULT 0 CHECK (upi_amount >= 0),
  payment_date  TEXT NOT NULL,
  upi_reference TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (cash_amount + upi_amount = amount)
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  attempts     INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name   TEXT,
  action      TEXT NOT NULL CHECK (action IN ('create','update','delete','reset','seed')),
  entity      TEXT NOT NULL,
  entity_id   INTEGER,
  description TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_household ON payments(household_id);
CREATE INDEX IF NOT EXISTS idx_payments_month_year ON payments(month, year);
CREATE INDEX IF NOT EXISTS idx_households_house_no ON households(house_no);
CREATE INDEX IF NOT EXISTS idx_households_name ON households(name);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`;

// Live binding: set once at boot by initDb(env) before any request is handled.
export let db = null;

/** D1 binds cannot take undefined — normalize to null. */
const clean = (v) => (v === undefined ? null : v);

function d1Adapter(DB) {
  return {
    prepare(sql) {
      return {
        async get(...args) {
          return DB.prepare(sql).bind(...args.map(clean)).first();
        },
        async all(...args) {
          const r = await DB.prepare(sql).bind(...args.map(clean)).all();
          return r.results || [];
        },
        async run(...args) {
          const r = await DB.prepare(sql).bind(...args.map(clean)).run();
          const meta = r.meta || {};
          return {
            lastInsertRowid: meta.last_row_id !== undefined ? Number(meta.last_row_id) : null,
            changes: meta.changes !== undefined ? Number(meta.changes) : 0,
          };
        },
      };
    },
    /** Atomic multi-statement write (D1's replacement for BEGIN/COMMIT). */
    async batch(stmts) {
      return DB.batch(
        stmts.map((s) => DB.prepare(s.sql).bind(...(s.params || []).map(clean)))
      );
    },
    async exec(sql) {
      return DB.exec(sql);
    },
  };
}

/**
 * Initialize the singleton. Called once at boot (Worker fetch / tests).
 *
 * The schema is applied statement-by-statement: D1's exec() rejects
 * multi-statement strings on the real binding (D1_EXEC_ERROR / incomplete
 * input), so exec() must not be used for the full schema. Every statement
 * is idempotent (CREATE ... IF NOT EXISTS), so this is safe on every boot.
 */
export async function initDb(env) {
  db = d1Adapter(env.DB);
  const statements = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
  for (const sql of statements) {
    await db.prepare(sql).run();
  }
  return db;
}

/** True when the database is empty and eligible for first-admin bootstrap. */
export async function isEmpty() {
  const households = await db.prepare('SELECT COUNT(*) AS c FROM households').get();
  const users = await db.prepare('SELECT COUNT(*) AS c FROM users').get();
  return households.c === 0 && users.c === 0;
}

const USER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Create a real user account (INITIAL_ADMIN_* bootstrap). Async because
 * password hashing is PBKDF2 (WebCrypto). Never returns or logs the password.
 */
export async function createUser({ name, email, password, role = 'treasurer' }) {
  const cleanName = String(name ?? '').trim();
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  const cleanRole = role === 'admin' ? 'admin' : 'treasurer';

  if (!cleanName) throw new Error('Name is required.');
  if (cleanName.length > 100) throw new Error('Name is too long (max 100 characters).');
  if (!USER_EMAIL_RE.test(cleanEmail)) throw new Error('Enter a valid email address.');
  if (String(password ?? '').length < 8) throw new Error('Password must be at least 8 characters.');

  const clash = await db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(cleanEmail);
  if (clash) throw new Error('A user with this email already exists.');

  const info = await db.prepare(
    'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(cleanName, cleanEmail, await hashPassword(password), cleanRole, isoNow());

  return db.prepare('SELECT id, name, email, role, status, created_at FROM users WHERE id = ?')
    .get(Number(info.lastInsertRowid));
}

/**
 * Duplicate protection: a payment already exists for (household, month, year).
 * Same query and semantics as the reference app (app-enforced, no DB unique
 * index — preserved exactly).
 */
export async function findDuplicatePayment(householdId, month, year, excludeId = null) {
  const sql = excludeId
    ? 'SELECT * FROM payments WHERE household_id = ? AND month = ? AND year = ? AND id != ?'
    : 'SELECT * FROM payments WHERE household_id = ? AND month = ? AND year = ?';
  const params = excludeId
    ? [householdId, month, year, excludeId]
    : [householdId, month, year];
  return db.prepare(sql).get(...params);
}
