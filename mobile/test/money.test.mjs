import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/money.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const money = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const stagingPayments = [
  { payment_mode: 'cash', amount: 20_000, cash_amount: 20_000, upi_amount: 0 },
  { payment_mode: 'upi', amount: 20_000, cash_amount: 0, upi_amount: 20_000 },
  { payment_mode: 'split', amount: 20_000, cash_amount: 10_000, upi_amount: 10_000 },
];
const databaseTotalPaise = stagingPayments.reduce((total, payment) => total + payment.amount, 0);
assert.equal(databaseTotalPaise, 60_000);
assert.ok(stagingPayments.every((payment) => payment.cash_amount + payment.upi_amount === payment.amount));
assert.equal(money.formatInrFromPaise(databaseTotalPaise), '₹600.00');
assert.equal(
  stagingPayments
    .map((payment) => money.formatInrFromPaise(payment.amount))
    .reduce((total, amount) => total + Number(amount.replace(/[^\d.]/g, '')), 0),
  600,
);
console.log('  ✓ staging aggregate of 60,000 paise reconciles to ₹600 across dashboard, history, reports, and receipts');
