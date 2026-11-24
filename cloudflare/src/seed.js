// Development-only seeding — port of the reference db.js ensureDemoUsers /
// seedSampleData. Same dataset, same rules. NEVER runs in production unless
// SEED_DEMO_USERS=1 / SEED_SAMPLE_DATA=1 are set explicitly (same opt-in
// rule as the reference app). Reset Sample Data stays server-side gated by
// demoResetEnabled().
import { db, isEmpty } from './db.js';
import { hashPassword } from './password.js';
import { logAudit } from './audit.js';
import { currentMonthYear, isoNow, MONTHS, todayKey } from './time.js';

export async function ensureDemoUsers() {
  const timestamp = isoNow();
  const insertIfMissing = async (name, email, password, role) => {
    const existing = await db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
    if (!existing) {
      await db.prepare('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(name, email, await hashPassword(password), role, timestamp);
      console.log(`Created demo ${role} user: ${email}`);
    }
  };
  await insertIfMissing('Treasurer', 'treasurer@shameem.example', 'treasurer123', 'treasurer');
  await insertIfMissing('Admin', 'admin@shameem.example', 'admin123', 'admin');
}

/** Seed realistic sample data (dynamic 3-month window). Returns true if seeded. */
export async function seedSampleData() {
  if (!(await isEmpty())) return false;

  const now = new Date();
  const { month: curMonth, year: curYear } = currentMonthYear(now);

  const months = [];
  for (let i = 2; i >= 0; i--) {
    let m = curMonth - i;
    let y = curYear;
    if (m < 1) { m += 12; y -= 1; }
    months.push({ month: m, year: y });
  }

  const timestamp = isoNow();
  const dayOfMonth = Number(todayKey(now).slice(-2));

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const treasurerId = Number((await insertUser.run('Treasurer', 'treasurer@shameem.example', await hashPassword('treasurer123'), 'treasurer', timestamp)).lastInsertRowid);
  const adminId = Number((await insertUser.run('Admin', 'admin@shameem.example', await hashPassword('admin123'), 'admin', timestamp)).lastInsertRowid);

  const insertHousehold = db.prepare(
    'INSERT INTO households (house_no, name, phone, monthly_amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
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
    const info = await insertHousehold.run(houseNo, name, phone, amount * 100, status, timestamp, timestamp);
    householdIds[houseNo] = Number(info.lastInsertRowid);
    await logAudit({
      userId: treasurerId, userName: 'Treasurer', action: 'create', entity: 'household',
      entityId: Number(info.lastInsertRowid),
      description: `Seeded household ${houseNo} (${name})`,
    });
  }

  const insertPayment = db.prepare(
    `INSERT INTO payments (household_id, month, year, amount, payment_mode, cash_amount, upi_amount, payment_date, upi_reference, notes, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const pay = async (houseNo, monthIndex, amount, mode, day, ref = null, notes = null) => {
    const { month, year } = months[monthIndex];
    const safeDay = Math.min(day, dayOfMonth);
    const date = `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
    const totalPaise = amount * 100;
    const cashPaise = mode === 'cash' ? totalPaise : 0;
    const upiPaise = mode === 'upi' ? totalPaise : 0;
    const info = await insertPayment.run(
      householdIds[houseNo], month, year, totalPaise, mode, cashPaise, upiPaise,
      date, ref, notes, timestamp, timestamp, treasurerId
    );
    await logAudit({
      userId: treasurerId, userName: 'Treasurer', action: 'create', entity: 'payment',
      entityId: Number(info.lastInsertRowid),
      description: `Seeded payment for ${houseNo} · ${MONTHS[month - 1]} ${year}`,
    });
  };

  const splitPay = async (houseNo, monthIndex, cashAmount, upiAmount, day, ref = null, notes = null) => {
    const { month, year } = months[monthIndex];
    const safeDay = Math.min(day, dayOfMonth);
    const date = `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
    const totalPaise = (cashAmount + upiAmount) * 100;
    const info = await insertPayment.run(
      householdIds[houseNo], month, year, totalPaise, 'split', cashAmount * 100, upiAmount * 100,
      date, ref, notes, timestamp, timestamp, treasurerId
    );
    await logAudit({
      userId: treasurerId, userName: 'Treasurer', action: 'create', entity: 'payment',
      entityId: Number(info.lastInsertRowid),
      description: `Seeded split payment for ${houseNo} · ${MONTHS[month - 1]} ${year}`,
    });
  };

  const MONTH_INDEX = { PREV2: 0, PREV1: 1, CURRENT: 2 };

  await pay('A-101', MONTH_INDEX.PREV2, 500, 'cash', 6);
  await pay('A-101', MONTH_INDEX.PREV1, 500, 'upi', 10, 'UPI-88210453');
  await pay('A-101', MONTH_INDEX.CURRENT, 500, 'upi', 12, 'UPI-99120457');

  await pay('A-102', MONTH_INDEX.PREV2, 750, 'upi', 5, 'UPI-77100231');
  await pay('A-102', MONTH_INDEX.PREV1, 750, 'upi', 8, 'UPI-77330190');

  await pay('A-103', MONTH_INDEX.PREV2, 500, 'cash', 9);
  await pay('A-103', MONTH_INDEX.PREV1, 500, 'cash', 7);
  await splitPay('A-103', MONTH_INDEX.CURRENT, 250, 250, 4);

  await pay('A-104', MONTH_INDEX.PREV2, 1000, 'upi', 3, 'UPI-66500012');
  await pay('A-104', MONTH_INDEX.PREV1, 1000, 'cash', 15);
  await pay('A-104', MONTH_INDEX.CURRENT, 1000, 'upi', 9, 'UPI-66890045');

  await pay('A-105', MONTH_INDEX.PREV1, 400, 'cash', 12);

  await pay('B-201', MONTH_INDEX.PREV2, 600, 'cash', 8);
  await pay('B-201', MONTH_INDEX.PREV1, 600, 'cash', 6);
  await pay('B-201', MONTH_INDEX.CURRENT, 600, 'cash', 3);

  await pay('B-202', MONTH_INDEX.PREV2, 500, 'upi', 11, 'UPI-55409921');
  await pay('B-202', MONTH_INDEX.PREV1, 500, 'upi', 5, 'UPI-55470086');
  await pay('B-202', MONTH_INDEX.CURRENT, 500, 'upi', 2, 'UPI-55900123');

  await pay('B-203', MONTH_INDEX.PREV2, 750, 'cash', 10);
  await pay('B-203', MONTH_INDEX.CURRENT, 750, 'cash', 6);

  await pay('C-301', MONTH_INDEX.PREV2, 1000, 'upi', 4, 'UPI-44112001');
  await pay('C-301', MONTH_INDEX.PREV1, 1000, 'upi', 9, 'UPI-44177892');
  await pay('C-301', MONTH_INDEX.CURRENT, 1000, 'cash', 8);

  await pay('C-302', MONTH_INDEX.CURRENT, 300, 'cash', 5);

  await logAudit({
    userId: adminId, userName: 'Admin', action: 'seed', entity: 'system',
    description: 'Sample data seeded (demo users, households and payments)',
  });

  const paid = await db.prepare('SELECT COUNT(*) AS c FROM payments').get();
  console.log(`Seeded sample data: ${households.length} households, ${paid.c} payments. Demo login: treasurer@shameem.example / treasurer123 · admin@shameem.example / admin123`);
  return true;
}
