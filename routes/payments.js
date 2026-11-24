import { Router } from 'express';
import { db, monthLabel } from '../db.js';
import { requireAuth } from '../auth.js';
import { validatePaymentInput, findDuplicatePayment, paymentPortions } from '../lib/validate.js';
import { toPaise, formatRupees } from '../lib/amounts.js';
import { logAudit } from '../lib/audit.js';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const PAYMENT_SELECT = `
  SELECT p.*, h.house_no, h.name AS household_name
    FROM payments p
    JOIN households h ON h.id = p.household_id
`;

function getPayment(id) {
  return db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(id);
}

function duplicateDetails(payment) {
  return {
    id: payment.id,
    amount_paise: payment.amount,
    payment_mode: payment.payment_mode,
    cash_amount_paise: payment.cash_amount,
    upi_amount_paise: payment.upi_amount,
    payment_date: payment.payment_date,
    upi_reference: payment.upi_reference,
    notes: payment.notes,
  };
}

// GET /api/payments/check?household_id=&month=&year=
// Duplicate check used by the Add Collection screen.
paymentsRouter.get('/check', (req, res) => {
  const householdId = Number(req.query.household_id);
  const month = Number(req.query.month);
  const year = Number(req.query.year);
  if (!Number.isInteger(householdId) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return res.status(400).json({ error: 'household_id, month and year are required.' });
  }
  const existing = findDuplicatePayment(householdId, month, year);
  res.json({ existing: existing ? {
    id: existing.id,
    amount_paise: existing.amount,
    payment_mode: existing.payment_mode,
    cash_amount_paise: existing.cash_amount,
    upi_amount_paise: existing.upi_amount,
    payment_date: existing.payment_date,
    upi_reference: existing.upi_reference,
    notes: existing.notes,
  } : null });
});

// GET /api/payments/:id
paymentsRouter.get('/:id(\\d+)', (req, res) => {
  const payment = getPayment(Number(req.params.id));
  if (!payment) return res.status(404).json({ error: 'Payment record not found.' });
  res.json({ payment });
});

// POST /api/payments
// Duplicate protection: if a payment already exists for (household, month,
// year) the server responds 409 with the existing record unless `force` is
// passed. Nothing is ever silently duplicated.
paymentsRouter.post('/', (req, res) => {
  const body = req.body ?? {};
  const errors = validatePaymentInput(body);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const householdId = Number(body.household_id);
  const month = Number(body.month);
  const year = Number(body.year);

  const household = db.prepare('SELECT id, house_no, name, status FROM households WHERE id = ?').get(householdId);
  if (!household) return res.status(404).json({ error: 'Household not found.' });

  const existing = findDuplicatePayment(householdId, month, year);
  if (existing && body.force !== true) {
    return res.status(409).json({
      error: `Payment already recorded for ${household.house_no} for ${monthLabel(month, year)}.`,
      duplicate: duplicateDetails(existing),
    });
  }

  const now = new Date().toISOString();
  const { cash, upi } = paymentPortions(body);
  const info = db.prepare(
    `INSERT INTO payments (household_id, month, year, amount, payment_mode, cash_amount, upi_amount, payment_date, upi_reference, notes, created_at, updated_at, created_by)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ? = 1 OR NOT EXISTS (
        SELECT 1 FROM payments WHERE household_id = ? AND month = ? AND year = ?
      )`
  ).run(
    householdId,
    month,
    year,
    toPaise(body.amount),
    body.payment_mode,
    cash,
    upi,
    String(body.payment_date).trim(),
    String(body.upi_reference ?? '').trim() || null,
    String(body.notes ?? '').trim() || null,
    now,
    now,
    req.user.id,
    body.force === true ? 1 : 0,
    householdId,
    month,
    year
  );

  if (info.changes === 0) {
    const concurrentDuplicate = findDuplicatePayment(householdId, month, year);
    if (concurrentDuplicate) {
      return res.status(409).json({
        error: `Payment already recorded for ${household.house_no} for ${monthLabel(month, year)}.`,
        duplicate: duplicateDetails(concurrentDuplicate),
      });
    }
    throw new Error('Payment was not inserted after passing duplicate validation.');
  }

  const payment = getPayment(Number(info.lastInsertRowid));
  logAudit({
    userId: req.user.id,
    userName: req.user.name,
    action: 'create',
    entity: 'payment',
    entityId: payment.id,
    description: `Recorded ${formatRupees(payment.amount)} for ${payment.house_no} · ${monthLabel(month, year)} (${payment.payment_mode.toUpperCase()})${existing ? ' — second entry' : ''}`,
    details: payment,
  });
  res.status(201).json({ payment, duplicate_overridden: Boolean(existing) });
});

// PUT /api/payments/:id
paymentsRouter.put('/:id(\\d+)', (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Payment record not found.' });

  const body = req.body ?? {};
  const errors = validatePaymentInput(body);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const householdId = Number(body.household_id);
  const month = Number(body.month);
  const year = Number(body.year);

  const household = db.prepare('SELECT id FROM households WHERE id = ?').get(householdId);
  if (!household) return res.status(404).json({ error: 'Household not found.' });

  const duplicate = findDuplicatePayment(householdId, month, year, id);
  if (duplicate && body.force !== true) {
    return res.status(409).json({
      error: `Another payment already exists for this household for ${monthLabel(month, year)}.`,
      duplicate: duplicateDetails(duplicate),
    });
  }

  const { cash, upi } = paymentPortions(body);
  const result = db.prepare(
    `UPDATE payments SET household_id = ?, month = ?, year = ?, amount = ?, payment_mode = ?,
            cash_amount = ?, upi_amount = ?, payment_date = ?, upi_reference = ?, notes = ?, updated_at = ?
      WHERE id = ?
        AND (? = 1 OR NOT EXISTS (
          SELECT 1 FROM payments
           WHERE household_id = ? AND month = ? AND year = ? AND id != ?
        ))`
  ).run(
    householdId,
    month,
    year,
    toPaise(body.amount),
    body.payment_mode,
    cash,
    upi,
    String(body.payment_date).trim(),
    String(body.upi_reference ?? '').trim() || null,
    String(body.notes ?? '').trim() || null,
    new Date().toISOString(),
    id,
    body.force === true ? 1 : 0,
    householdId,
    month,
    year,
    id
  );

  if (result.changes === 0) {
    const concurrentDuplicate = findDuplicatePayment(householdId, month, year, id);
    if (concurrentDuplicate) {
      return res.status(409).json({
        error: `Another payment already exists for this household for ${monthLabel(month, year)}.`,
        duplicate: duplicateDetails(concurrentDuplicate),
      });
    }
    const stillExists = db.prepare('SELECT id FROM payments WHERE id = ?').get(id);
    if (!stillExists) return res.status(404).json({ error: 'Payment record not found.' });
    throw new Error('Payment was not updated after passing duplicate validation.');
  }

  const updated = getPayment(id);
  logAudit({
    userId: req.user.id,
    userName: req.user.name,
    action: 'update',
    entity: 'payment',
    entityId: id,
    description: `Updated payment for ${updated.house_no} · ${monthLabel(month, year)}`,
    details: { before: current, after: updated },
  });
  res.json({ payment: updated });
});

// DELETE /api/payments/:id
// The client shows a confirmation dialog before calling this.
paymentsRouter.delete('/:id(\\d+)', (req, res) => {
  const id = Number(req.params.id);
  const existing = getPayment(id);
  if (!existing) return res.status(404).json({ error: 'Payment record not found.' });
  db.prepare('DELETE FROM payments WHERE id = ?').run(id);
  logAudit({
    userId: req.user.id,
    userName: req.user.name,
    action: 'delete',
    entity: 'payment',
    entityId: id,
    description: `Deleted ${formatRupees(existing.amount)} for ${existing.house_no} · ${monthLabel(existing.month, existing.year)}`,
    details: existing,
  });
  res.json({ ok: true });
});
