// Resets the database completely (drops all tables) and reseeds sample data.
// Run with: npm run reset-db
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initDb, seedSampleData } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

initDb();
db.exec('DROP TABLE IF EXISTS payments');
db.exec('DROP TABLE IF EXISTS households');
db.exec('DROP TABLE IF EXISTS sessions');
db.exec('DROP TABLE IF EXISTS audit_log');
db.exec('DROP TABLE IF EXISTS users');

initDb();
seedSampleData();

// Remove WAL sidecar files so the DB file is clean.
for (const suffix of ['-wal', '-shm']) {
  try { fs.unlinkSync(path.join(dataDir, `chanda.db${suffix}`)); } catch { /* ignore */ }
}

console.log('Database reset complete. Demo login: treasurer@shameem.example / treasurer123');
