// Asia/Kolkata business-time tests — Safeguard 2.
//
// Verifies the exact boundary the user required:
//   2026-08-31 23:55 IST   -> month = August 2026, today = 2026-08-31
//   2026-09-01 00:05 IST   -> month = September 2026, today = 2026-09-01
// plus the future-date guard, timestamps, and a configurable-tz check.
import {
  configureTime, currentMonthYear, todayKey, isoNow, isFuturePaymentDate,
  tzMonthOfInstant, longDate,
} from '../src/time.js';

let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function instant(y, mo, d, h, mi, s = 0) {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

// Run with an explicit tz so the suite is deterministic regardless of host.
configureTime({ tz: 'Asia/Kolkata' });

console.log('\n== Asia/Kolkata boundary tests ==');

// 2026-08-31 23:55 IST == 2026-08-31 18:25 UTC
const beforeMidnight = instant(2026, 8, 31, 18, 25, 0);
{
  const { month, year } = currentMonthYear(beforeMidnight);
  assert('2026-08-31 23:55 IST -> month = 8, year = 2026', month === 8 && year === 2026);
  assert('2026-08-31 23:55 IST -> todayKey = 2026-08-31', todayKey(beforeMidnight) === '2026-08-31');
  assert('isoNow carries +05:30 offset', isoNow(beforeMidnight) === '2026-08-31T23:55:00+05:30');
  assert('longDate = "31 August 2026"', longDate(isoNow(beforeMidnight)) === '31 August 2026');
}

// 2026-09-01 00:05 IST == 2026-08-31 18:35 UTC (the critical rollover instant)
const afterMidnight = instant(2026, 8, 31, 18, 35, 0);
{
  const { month, year } = currentMonthYear(afterMidnight);
  assert('2026-09-01 00:05 IST -> month = 9, year = 2026 (rollover correct)', month === 9 && year === 2026);
  assert('2026-09-01 00:05 IST -> todayKey = 2026-09-01', todayKey(afterMidnight) === '2026-09-01');
  assert('isoNow = 2026-09-01T00:05:00+05:30', isoNow(afterMidnight) === '2026-09-01T00:05:00+05:30');
  assert('longDate = "1 September 2026"', longDate(isoNow(afterMidnight)) === '1 September 2026');
}

console.log('\n== Future-date guard (payment dated by the treasurer in IST) ==');

// At 23:55 IST on Aug 31, a payment dated 2026-09-01 IS in the future.
assert('23:55 IST Aug 31: payment dated 2026-09-01 is future (rejected)', isFuturePaymentDate('2026-09-01', beforeMidnight) === true);
// At 00:05 IST on Sep 1, the same date is TODAY and must NOT be rejected.
assert('00:05 IST Sep 1: payment dated 2026-09-01 is today (accepted)', isFuturePaymentDate('2026-09-01', afterMidnight) === false);
assert('23:55 IST Aug 31: payment dated 2026-08-31 is today (accepted)', isFuturePaymentDate('2026-08-31', beforeMidnight) === false);
assert('00:05 IST Sep 1: payment dated 2026-09-02 is future (rejected)', isFuturePaymentDate('2026-09-02', afterMidnight) === true);

console.log('\n== Stored-instant month extraction (household created_at) ==');

const created = tzMonthOfInstant('2026-08-31T18:35:00Z');
assert('created_at 2026-08-31T18:35:00Z -> month 9 / 2026 (IST boundary)', created && created.month === 9 && created.year === 2026);
const created2 = tzMonthOfInstant('2026-08-31T18:25:00Z');
assert('created_at 2026-08-31T18:25:00Z -> month 8 / 2026', created2 && created2.month === 8 && created2.year === 2026);

console.log('\n== Configurable timezone (APP_TZ honored) ==');

configureTime({ tz: 'UTC' });
{
  const { month, year } = currentMonthYear(afterMidnight); // 18:35 UTC Aug 31
  assert('UTC 18:35 Aug 31 -> month = 8 (server-local equivalent)', month === 8 && year === 2026);
  assert('UTC today = 2026-08-31', todayKey(afterMidnight) === '2026-08-31');
}
configureTime({ tz: 'Asia/Kolkata' }); // restore default for other tests

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES: ' + failed}  (${passed} assertions)\n`);
process.exit(failed === 0 ? 0 : 1);
