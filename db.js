// Database layer: opens the SQLite file, creates the schema, seeds sample data.
import './env.js'; // loads .env before any process.env.* reads
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './lib/password.js';
import { logAudit } from './lib/audit.js';
import { currentMonthYear, todayKey } from './lib/time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'chanda.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function initDb() {
  db.exec(`
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
  `);

  // Migration: databases created before the Admin/status feature don't have
  // the users.status column yet. Add it without touching existing rows.
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('status')) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
    console.log('Migrated: added users.status column');
  }

  migratePaymentsTable();
}

/**
 * Migration for the payments table. Databases created before split payments
 * exist with the old 2-mode schema and an `ON DELETE CASCADE` household FK.
 * Rebuild the table so that:
 *   - payment_mode supports cash | upi | split
 *   - cash_amount / upi_amount columns hold the per-mode paise (always
 *     populated, always cash + upi = amount — enforced by a table CHECK)
 *   - deleting a household can never cascade-destroy financial records
 *     (ON DELETE RESTRICT), and deleting a user preserves payments while
 *     nulling created_by (ON DELETE SET NULL)
 * Existing rows are copied untouched, with cash/upi amounts backfilled from
 * the payment mode.
 */
function migratePaymentsTable() {
  const cols = db.prepare('PRAGMA table_info(payments)').all().map((c) => c.name);
  if (cols.includes('cash_amount')) return; // already current

  console.log('Migrating payments table to split-payment schema…');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE payments_new (
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
      INSERT INTO payments_new
        (id, household_id, month, year, amount, payment_mode, cash_amount, upi_amount,
         payment_date, upi_reference, notes, created_at, updated_at, created_by)
        SELECT id, household_id, month, year, amount, payment_mode,
               CASE WHEN payment_mode = 'cash' THEN amount ELSE 0 END,
               CASE WHEN payment_mode = 'upi'  THEN amount ELSE 0 END,
               payment_date, upi_reference, notes, created_at, updated_at, created_by
          FROM payments;
      DROP TABLE payments;
      ALTER TABLE payments_new RENAME TO payments;
      CREATE INDEX IF NOT EXISTS idx_payments_household ON payments(household_id);
      CREATE INDEX IF NOT EXISTS idx_payments_month_year ON payments(month, year);
    `);
    db.exec('COMMIT');
    console.log('Migrated: payments table now supports split payments.');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Idempotent migration: makes sure the demo users exist even on databases
 * that were created before the Admin role was introduced. Never touches
 * existing records.
 */
export function ensureDemoUsers() {
  const timestamp = new Date().toISOString();
  const insertIfMissing = (name, email, password, role) => {
    const existing = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
    if (!existing) {
      db.prepare('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(name, email, hashPassword(password), role, timestamp);
      console.log(`Created demo ${role} user: ${email}`);
    }
  };
  insertIfMissing('Treasurer', 'treasurer@shameem.example', 'treasurer123', 'treasurer');
  insertIfMissing('Admin', 'admin@shameem.example', 'admin123', 'admin');
}

/** True when the database is empty and should be seeded. */
export function isEmpty() {
  const households = db.prepare('SELECT COUNT(*) AS c FROM households').get().c;
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  return households === 0 && users === 0;
}

/**
 * Seed realistic sample data so the app can be demoed immediately.
 * Seeding is dynamic: it always fills the 3 calendar months ending at the
 * current month, so the dashboard always shows a live-looking month.
 */
export function seedSampleData() {
  if (!isEmpty()) return false;

  const now = new Date();
  const { month: curMonth, year: curYear } = currentMonthYear(now);

  // The three months [current - 2, current - 1, current].
  const months = [];
  for (let i = 2; i >= 0; i--) {
    let m = curMonth - i;
    let y = curYear;
    if (m < 1) { m += 12; y -= 1; }
    months.push({ month: m, year: y });
  }

  const timestamp = now.toISOString();
  const dayOfMonth = Number(todayKey(now).slice(-2));

  db.exec('BEGIN');

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const userId = Number(insertUser.run('Treasurer', 'treasurer@shameem.example', hashPassword('treasurer123'), 'treasurer', timestamp).lastInsertRowid);
  const adminId = Number(insertUser.run('Admin', 'admin@shameem.example', hashPassword('admin123'), 'admin', timestamp).lastInsertRowid);

  const insertHousehold = db.prepare(
    'INSERT INTO households (house_no, name, phone, monthly_amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  // NOTE: amounts below are in rupees; they are converted to paise (×100)
  // before insert so every stored value is exact integer paise.
  // [house_no, name, phone, monthly_amount, status]
  const households = [
    ['A-101', 'Abdul Rahman', '98765 43210', 500, 'active'],
    ['A-102', 'Mohammed Imran', '98111 22334', 750, 'active'],
    ['A-103', 'Farhan Ahmed', '98222 33445', 500, 'active'],
    ['A-104', 'Yusuf Khan', '98333 44556', 1000, 'active'],
    ['A-105', 'Sirajuddin Qureshi', '98444 55667', 400, 'active'],
    ['B-201', 'Naseem Fatima', '98555 66778', 600, 'active'],
    ['B-202', 'Khalid Hussain', '98666 77889', 500, 'active'],
    ['B-203', 'Ayesha Siddiqua', '98777 88990', 750, 'active'],
    ['C-301', 'Usman Ali', '98888 99001', 1000, 'active'],
    ['C-302', 'Zubair Ahmed', '98999 00112', 300, 'active'],
    ['A-106', 'Irfan Shaikh', '98123 45678', 500, 'inactive'],
  ];

  const householdIds = {};
  for (const [houseNo, name, phone, amount, status] of households) {
    const info = insertHousehold.run(houseNo, name, phone, amount * 100, status, timestamp, timestamp);
    householdIds[houseNo] = Number(info.lastInsertRowid);
    logAudit({
      userId, userName: 'Treasurer', action: 'create', entity: 'household',
      entityId: Number(info.lastInsertRowid),
      description: `Seeded household ${houseNo} (${name})`,
    });
  }

  const insertPayment = db.prepare(
    `INSERT INTO payments (household_id, month, year, amount, payment_mode, cash_amount, upi_amount, payment_date, upi_reference, notes, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // pay(houseNo, monthIndex, amount, mode, day, ref, notes)
  // For 'split', pass the cash portion as amount and the upi portion as ref
  // position — handled via the explicit splitPay helper below.
  const pay = (houseNo, monthIndex, amount, mode, day, ref = null, notes = null) => {
    const { month, year } = months[monthIndex];
    const safeDay = Math.min(day, dayOfMonth);
    const date = `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
    const totalPaise = amount * 100;
    const cashPaise = mode === 'cash' ? totalPaise : 0;
    const upiPaise = mode === 'upi' ? totalPaise : 0;
    const info = insertPayment.run(
      householdIds[houseNo], month, year, totalPaise, mode, cashPaise, upiPaise,
      date, ref, notes, timestamp, timestamp, userId
    );
    logAudit({
      userId, userName: 'Treasurer', action: 'create', entity: 'payment',
      entityId: Number(info.lastInsertRowid),
      description: `Seeded payment for ${houseNo} · ${MONTHS[month - 1]} ${year}`,
    });
  };

  // Split payment: cash portion + upi portion must equal the total.
  const splitPay = (houseNo, monthIndex, cashAmount, upiAmount, day, ref = null, notes = null) => {
    const { month, year } = months[monthIndex];
    const safeDay = Math.min(day, dayOfMonth);
    const date = `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
    const totalPaise = (cashAmount + upiAmount) * 100;
    const info = insertPayment.run(
      householdIds[houseNo], month, year, totalPaise, 'split', cashAmount * 100, upiAmount * 100,
      date, ref, notes, timestamp, timestamp, userId
    );
    logAudit({
      userId, userName: 'Treasurer', action: 'create', entity: 'payment',
      entityId: Number(info.lastInsertRowid),
      description: `Seeded split payment for ${houseNo} · ${MONTHS[month - 1]} ${year}`,
    });
  };

  const MONTH_INDEX = { PREV2: 0, PREV1: 1, CURRENT: 2 };

  // Most households paid all 3 months; a few have missing months on purpose.
  pay('A-101', MONTH_INDEX.PREV2, 500, 'cash', 6);
  pay('A-101', MONTH_INDEX.PREV1, 500, 'upi', 10, 'UPI-88210453');
  pay('A-101', MONTH_INDEX.CURRENT, 500, 'upi', 12, 'UPI-99120457');

  pay('A-102', MONTH_INDEX.PREV2, 750, 'upi', 5, 'UPI-77100231');
  pay('A-102', MONTH_INDEX.PREV1, 750, 'upi', 8, 'UPI-77330190');
  // A-102 missing the current month -> appears as pending.

  pay('A-103', MONTH_INDEX.PREV2, 500, 'cash', 9);
  pay('A-103', MONTH_INDEX.PREV1, 500, 'cash', 7);
  // Current month: split payment — ₹250 cash + ₹250 UPI = ₹500 total.
  splitPay('A-103', MONTH_INDEX.CURRENT, 250, 250, 4);

  pay('A-104', MONTH_INDEX.PREV2, 1000, 'upi', 3, 'UPI-66500012');
  pay('A-104', MONTH_INDEX.PREV1, 1000, 'cash', 15);
  pay('A-104', MONTH_INDEX.CURRENT, 1000, 'upi', 9, 'UPI-66890045');

  // A-105 paid only the previous month -> pending in current month.
  pay('A-105', MONTH_INDEX.PREV1, 400, 'cash', 12);

  pay('B-201', MONTH_INDEX.PREV2, 600, 'cash', 8);
  pay('B-201', MONTH_INDEX.PREV1, 600, 'cash', 6);
  pay('B-201', MONTH_INDEX.CURRENT, 600, 'cash', 3);

  pay('B-202', MONTH_INDEX.PREV2, 500, 'upi', 11, 'UPI-55409921');
  pay('B-202', MONTH_INDEX.PREV1, 500, 'upi', 5, 'UPI-55470086');
  pay('B-202', MONTH_INDEX.CURRENT, 500, 'upi', 2, 'UPI-55900123');

  // B-203 missing the previous month.
  pay('B-203', MONTH_INDEX.PREV2, 750, 'cash', 10);
  pay('B-203', MONTH_INDEX.CURRENT, 750, 'cash', 6);

  pay('C-301', MONTH_INDEX.PREV2, 1000, 'upi', 4, 'UPI-44112001');
  pay('C-301', MONTH_INDEX.PREV1, 1000, 'upi', 9, 'UPI-44177892');
  pay('C-301', MONTH_INDEX.CURRENT, 1000, 'cash', 8);

  // C-302 paid only the current month (joined late, or was pending earlier).
  pay('C-302', MONTH_INDEX.CURRENT, 300, 'cash', 5);

  db.exec('COMMIT');

  logAudit({
    userId: adminId, userName: 'Admin', action: 'seed', entity: 'system',
    description: 'Sample data seeded (demo users, households and payments)',
  });

  const paid = db.prepare('SELECT COUNT(*) AS c FROM payments').get().c;
  console.log(`Seeded sample data: ${households.length} households, ${paid} payments. Demo login: treasurer@shameem.example / treasurer123 · admin@shameem.example / admin123`);
  return true;
}

const USER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Create a real user account (used by the CLI first-admin flow and the
 * INITIAL_ADMIN_* production bootstrap). Validates input, hashes the password
 * with scrypt, and never returns or logs the password. Throws on invalid
 * input or duplicate email.
 */
export function createUser({ name, email, password, role = 'treasurer' }) {
  const cleanName = String(name ?? '').trim();
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  const cleanRole = role === 'admin' ? 'admin' : 'treasurer';

  if (!cleanName) throw new Error('Name is required.');
  if (cleanName.length > 100) throw new Error('Name is too long (max 100 characters).');
  if (!USER_EMAIL_RE.test(cleanEmail)) throw new Error('Enter a valid email address.');
  if (String(password ?? '').length < 8) throw new Error('Password must be at least 8 characters.');

  const clash = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(cleanEmail);
  if (clash) throw new Error('A user with this email already exists.');

  const info = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(cleanName, cleanEmail, hashPassword(password), cleanRole, new Date().toISOString());

  return db.prepare('SELECT id, name, email, role, status, created_at FROM users WHERE id = ?')
    .get(Number(info.lastInsertRowid));
}

export function monthLabel(month, year) {
  return `${MONTHS[month - 1]} ${year}`;
}

export { currentMonthYear, MONTHS };
