import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { configureTime, currentMonthYear, todayKey, isoNow, isFuturePaymentDate, longDate } from '../lib/time.js';

console.log('\n== Asia/Kolkata boundary tests (Root App) ==');

// 1. Just before midnight IST on Aug 31, 2026: 2026-08-31 23:55:00 IST
// (which is 2026-08-31T18:25:00Z)
const beforeMidnight = new Date('2026-08-31T18:25:00Z');
configureTime({ tz: 'Asia/Kolkata', now: () => beforeMidnight });

const ym1 = currentMonthYear();
assert.equal(ym1.month, 8);
assert.equal(ym1.year, 2026);
console.log('  ✓ 2026-08-31 23:55 IST -> month = 8, year = 2026');

assert.equal(todayKey(), '2026-08-31');
console.log('  ✓ 2026-08-31 23:55 IST -> todayKey = 2026-08-31');

assert.equal(isFuturePaymentDate('2026-09-01'), true);
console.log('  ✓ 23:55 IST Aug 31: payment dated 2026-09-01 is future (rejected)');

// 2. Just after midnight IST on Sep 1, 2026: 2026-09-01 00:05:00 IST
// (which is 2026-08-31T18:35:00Z)
const afterMidnight = new Date('2026-08-31T18:35:00Z');
configureTime({ tz: 'Asia/Kolkata', now: () => afterMidnight });

const ym2 = currentMonthYear();
assert.equal(ym2.month, 9);
assert.equal(ym2.year, 2026);
console.log('  ✓ 2026-09-01 00:05 IST -> month = 9, year = 2026 (rollover correct)');

assert.equal(todayKey(), '2026-09-01');
console.log('  ✓ 2026-09-01 00:05 IST -> todayKey = 2026-09-01');

assert.equal(isFuturePaymentDate('2026-09-01'), false);
console.log('  ✓ 00:05 IST Sep 1: payment dated 2026-09-01 is today (accepted)');

const tempDir = mkdtempSync(path.join(tmpdir(), 'chanda-time-test-'));
process.env.DB_PATH = path.join(tempDir, 'time-test.db');
const { currentMonthYear: dbCurrentMonthYear, db } = await import('../db.js');
assert.deepEqual(dbCurrentMonthYear(afterMidnight), { month: 9, year: 2026 });
console.log('  ✓ root database helper uses business timezone');
db.close();
rmSync(tempDir, { recursive: true, force: true });

console.log('\nALL TIME TESTS PASSED');
