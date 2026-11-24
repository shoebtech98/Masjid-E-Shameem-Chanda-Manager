// Removes every QA-* sample household, its payments, and the audit entries
// those records produced. Safe: only touches house numbers starting with "QA-".
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/chanda.db');

const qaHouseholds = db.prepare("SELECT id, house_no FROM households WHERE house_no LIKE 'QA-%'").all();
console.log(`QA households found: ${qaHouseholds.length}`);
const qaHouseIds = qaHouseholds.map((h) => h.id);

let payCount = 0;
let auditRows = 0;
if (qaHouseIds.length) {
  const marks = qaHouseIds.map(() => '?').join(',');
  payCount = db.prepare(`SELECT COUNT(*) c FROM payments WHERE household_id IN (${marks})`).all(...qaHouseIds)[0].c;
  db.prepare(`DELETE FROM payments WHERE household_id IN (${marks})`).run(...qaHouseIds);
  db.prepare(`DELETE FROM households WHERE id IN (${marks})`).run(...qaHouseIds);
  // audit: household create entries carry the household entity_id
  auditRows += db.prepare(`DELETE FROM audit_log WHERE entity = 'household' AND entity_id IN (${marks})`).run(...qaHouseIds).changes;
  // audit: payment entries (create/update/delete) reference QA house numbers in descriptions
  auditRows += db.prepare(`DELETE FROM audit_log WHERE entity = 'payment' AND description GLOB '*QA-*'`).run().changes;
}

console.log(`Deleted ${payCount} QA payments, ${qaHouseIds.length} QA households, ${auditRows} audit rows`);

// Verify pristine state
const households = db.prepare('SELECT COUNT(*) c FROM households').get().c;
const payments = db.prepare('SELECT COUNT(*) c FROM payments').get().c;
const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
const remainingQa = db.prepare("SELECT COUNT(*) c FROM households WHERE house_no LIKE 'QA-%'").get().c;
console.log(JSON.stringify({ households, payments, users, remainingQaHouseholds: remainingQa }, null, 1));
if (households !== 12 || payments !== 25 || users !== 2 || remainingQa !== 0) {
  console.error('CLEANUP INCOMPLETE — expected 12 households / 25 payments / 2 users / 0 QA households');
  process.exit(1);
}
console.log('Pristine state restored ✓');
