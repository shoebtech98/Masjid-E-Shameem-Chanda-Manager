import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/dates.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const dates = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

process.env.TZ = 'Pacific/Kiritimati';
const calendarDate = dates.parseCalendarDate('2026-11-15');
assert.ok(calendarDate);
assert.equal(dates.calendarDateString(calendarDate), '2026-11-15');
assert.equal(dates.isSelectablePaymentDate('2026-11-15', '2026-11-15'), true);
assert.equal(dates.isSelectablePaymentDate('2026-11-14', '2026-11-15'), true);
assert.equal(dates.isSelectablePaymentDate('2026-11-16', '2026-11-15'), false);
assert.equal(dates.isSelectablePaymentDate('2026-02-30', '2026-11-15'), false);
console.log('  ✓ today and past dates are selectable; future and invalid dates are rejected without UTC day shifts');

assert.equal(dates.businessDate(new Date('2026-11-14T18:29:59.000Z')), '2026-11-14');
assert.equal(dates.businessDate(new Date('2026-11-14T18:30:00.000Z')), '2026-11-15');
console.log('  ✓ business date advances at Asia/Kolkata midnight');
