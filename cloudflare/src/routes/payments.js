import { Hono } from 'hono';
import { db, findDuplicatePayment } from '../db.js';
import { requireAuth } from '../auth.js';
import { validatePaymentInput, paymentPortions } from '../validate.js';
import { toPaise, formatRupees } from '../amounts.js';
import { logAudit } from '../audit.js';
import { isoNow, monthLabel } from '../time.js';

export const paymentsRouter = new Hono();
paymentsRouter.use('*', requireAuth);

const PAYMENT_SELECT = `
  SELECT p.*, h.house_no, h.name AS household_name
    FROM payments p
    JOIN households h ON h.id = p.household_id
`;

async function getPayment(id) {
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
paymentsRouter.get('/check', async (c) => {
  const q = c.req.query();
  const householdId = Number(q.household_id);
  const month = Number(q.month);
  const year = Number(q.year);
  if (!Number.isInteger(householdId) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return c.json({ error: 'household_id, month and year are required.' }, 400);
  }
  const existing = await findDuplicatePayment(householdId, month, year);
  return c.json({ existing: existing ? {
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
paymentsRouter.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Not found.' }, 404);
  const payment = await getPayment(id);
  if (!payment) return c.json({ error: 'Payment record not found.' }, 404);
  return c.json({ payment });
});

// POST /api/payments
// Duplicate protection: (household, month, year) -> 409 with the existing
// record unless `force` is passed. Nothing is ever silently duplicated.
paymentsRouter.post('/', async (c) => {
  let body = null;
  try { body = await c.req.json(); } catch { /* 400 below */ }
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON in request body.' }, 400);
  const errors = validatePaymentInput(body);
  if (errors.length) return c.json({ error: errors[0], errors }, 400);

  const householdId = Number(body.household_id);
  const month = Number(body.month);
  const year = Number(body.year);

  const household = await db.prepare('SELECT id, house_no, name, status FROM households WHERE id = ?').get(householdId);
  if (!household) return c.json({ error: 'Household not found.' }, 404);

  const existing = await findDuplicatePayment(householdId, month, year);
  if (existing && body.force !== true) {
    return c.json({
      error: `Payment already recorded for ${household.house_no} for ${monthLabel(month, year)}.`,
      duplicate: duplicateDetails(existing),
    }, 409);
  }

  const now = isoNow();
  const { cash, upi } = paymentPortions(body);
  const info = await db.prepare(
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
    c.get('user').id,
    body.force === true ? 1 : 0,
    householdId,
    month,
    year
  );

  if (info.changes === 0) {
    const concurrentDuplicate = await findDuplicatePayment(householdId, month, year);
    if (concurrentDuplicate) {
      return c.json({
        error: `Payment already recorded for ${household.house_no} for ${monthLabel(month, year)}.`,
        duplicate: duplicateDetails(concurrentDuplicate),
      }, 409);
    }
    throw new Error('Payment was not inserted after passing duplicate validation.');
  }

  const payment = await getPayment(Number(info.lastInsertRowid));
  await logAudit({
    userId: c.get('user').id,
    userName: c.get('user').name,
    action: 'create',
    entity: 'payment',
    entityId: payment.id,
    description: `Recorded ${formatRupees(payment.amount)} for ${payment.house_no} · ${monthLabel(month, year)} (${payment.payment_mode.toUpperCase()})${existing ? ' — second entry' : ''}`,
    details: payment,
  });
  return c.json({ payment, duplicate_overridden: Boolean(existing) }, 201);
});

// PUT /api/payments/:id
paymentsRouter.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Not found.' }, 404);
  const current = await db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!current) return c.json({ error: 'Payment record not found.' }, 404);

  let body = null;
  try { body = await c.req.json(); } catch { /* 400 below */ }
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON in request body.' }, 400);
  const errors = validatePaymentInput(body);
  if (errors.length) return c.json({ error: errors[0], errors }, 400);

  const householdId = Number(body.household_id);
  const month = Number(body.month);
  const year = Number(body.year);

  const household = await db.prepare('SELECT id FROM households WHERE id = ?').get(householdId);
  if (!household) return c.json({ error: 'Household not found.' }, 404);

  const duplicate = await findDuplicatePayment(householdId, month, year, id);
  if (duplicate && body.force !== true) {
    return c.json({
      error: `Another payment already exists for this household for ${monthLabel(month, year)}.`,
      duplicate: duplicateDetails(duplicate),
    }, 409);
  }

  const { cash, upi } = paymentPortions(body);
  const result = await db.prepare(
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
    isoNow(),
    id,
    body.force === true ? 1 : 0,
    householdId,
    month,
    year,
    id
  );

  if (result.changes === 0) {
    const concurrentDuplicate = await findDuplicatePayment(householdId, month, year, id);
    if (concurrentDuplicate) {
      return c.json({
        error: `Another payment already exists for this household for ${monthLabel(month, year)}.`,
        duplicate: duplicateDetails(concurrentDuplicate),
      }, 409);
    }
    const stillExists = await db.prepare('SELECT id FROM payments WHERE id = ?').get(id);
    if (!stillExists) return c.json({ error: 'Payment record not found.' }, 404);
    throw new Error('Payment was not updated after passing duplicate validation.');
  }

  const updated = await getPayment(id);
  await logAudit({
    userId: c.get('user').id,
    userName: c.get('user').name,
    action: 'update',
    entity: 'payment',
    entityId: id,
    description: `Updated payment for ${updated.house_no} · ${monthLabel(month, year)}`,
    details: { before: current, after: updated },
  });
  return c.json({ payment: updated });
});

// DELETE /api/payments/:id
paymentsRouter.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Not found.' }, 404);
  const existing = await getPayment(id);
  if (!existing) return c.json({ error: 'Payment record not found.' }, 404);
  await db.prepare('DELETE FROM payments WHERE id = ?').run(id);
  await logAudit({
    userId: c.get('user').id,
    userName: c.get('user').name,
    action: 'delete',
    entity: 'payment',
    entityId: id,
    description: `Deleted ${formatRupees(existing.amount)} for ${existing.house_no} · ${monthLabel(existing.month, existing.year)}`,
    details: existing,
  });
  return c.json({ ok: true });
});
