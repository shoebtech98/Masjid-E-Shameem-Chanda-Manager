-- Masjid E Shameem – Chanda Manager · D1 schema
-- GENERATED from src/db.js (export const SCHEMA) — do not edit by hand.
-- Regenerate with:  npm run emit-schema
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
