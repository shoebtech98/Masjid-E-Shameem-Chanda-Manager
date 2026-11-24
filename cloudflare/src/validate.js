// Shared input validation — port of the reference lib/validate.js.
// Same rules, same error strings, same behavior. The only change: the
// db-dependent findDuplicatePayment helper lives in db.js; this module is pure.
// Future-date validation uses the Asia/Kolkata business date (time.js).
import { toPaise, formatRupees } from './amounts.js';
import { isFuturePaymentDate, currentMonthYear } from './time.js';

export function validateHousehold(body) {
  const errors = [];
  const houseNo = String(body.house_no ?? '').trim();
  const name = String(body.name ?? '').trim();

  if (!houseNo) errors.push('House number is required.');
  else if (houseNo.length > 20) errors.push('House number is too long (max 20 characters).');

  if (!name) errors.push('Resident name is required.');
  else if (name.length > 100) errors.push('Name is too long (max 100 characters).');

  if (body.phone !== undefined && body.phone !== null && String(body.phone).trim() !== '') {
    const phone = String(body.phone).trim();
    if (phone.length > 20) errors.push('Phone number is too long (max 20 characters).');
    else if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) errors.push('Phone number looks invalid.');
  }

  const paise = toPaise(body.monthly_amount);
  if (paise === null || paise <= 0) errors.push('Monthly chanda amount must be a valid amount greater than zero.');

  if (body.status !== undefined && body.status !== 'active' && body.status !== 'inactive') {
    errors.push('Status must be active or inactive.');
  }

  return errors;
}

export function validatePaymentInput(body) {
  const errors = [];

  const householdId = Number(body.household_id);
  if (!Number.isInteger(householdId) || householdId <= 0) errors.push('A household must be selected.');

  const month = Number(body.month);
  if (!Number.isInteger(month) || month < 1 || month > 12) errors.push('Month must be between 1 and 12.');

  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) errors.push('Year is not valid.');

  const paise = toPaise(body.amount);
  if (paise === null || paise <= 0) errors.push('Amount must be a valid amount greater than zero.');

  const mode = body.payment_mode;
  if (mode !== 'cash' && mode !== 'upi' && mode !== 'split') {
    errors.push('Payment mode must be Cash, UPI, or Split.');
  }

  // Split payments: cash + UPI portions must be present and reconcile exactly
  // to the total amount. Cash/UPI payments derive their portions from the
  // total, so any client-supplied split values are ignored for them.
  if (mode === 'split' && paise !== null && paise > 0) {
    const rawCash = String(body.cash_amount ?? '').trim();
    const rawUpi = String(body.upi_amount ?? '').trim();
    const cashPaise = toPaise(body.cash_amount);
    const upiPaise = toPaise(body.upi_amount);
    if (/^-/.test(rawCash) || /^-/.test(rawUpi)) {
      errors.push('Split amounts cannot be negative.');
    } else if (cashPaise === null || upiPaise === null) {
      errors.push('Enter both the cash and UPI amounts for a split payment.');
    } else if (cashPaise + upiPaise !== paise) {
      errors.push(`Cash (${formatRupees(cashPaise)}) + UPI (${formatRupees(upiPaise)}) must equal the total (${formatRupees(paise)}).`);
    }
  }

  const dateStr = String(body.payment_date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    errors.push('A valid payment date is required.');
  } else {
    const [yy, mm, dd] = dateStr.split('-').map(Number);
    // Validate it is a real calendar date, then compare against "today" in
    // Asia/Kolkata — a payment dated today (IST) must never be rejected as
    // future just because the server runs UTC.
    const d = new Date(Date.UTC(yy, mm - 1, dd));
    const isRealDate = d.getUTCFullYear() === yy && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd;
    if (!isRealDate) {
      errors.push('Payment date is not a valid calendar date.');
    } else if (isFuturePaymentDate(dateStr)) {
      errors.push('Payment date cannot be in the future.');
    }
  }

  if (body.upi_reference !== undefined && body.upi_reference !== null) {
    const ref = String(body.upi_reference).trim();
    if (ref.length > 100) errors.push('UPI reference is too long (max 100 characters).');
  }

  if (body.notes !== undefined && body.notes !== null) {
    const notes = String(body.notes).trim();
    if (notes.length > 500) errors.push('Notes are too long (max 500 characters).');
  }

  return errors;
}

export function parseMonthYear(query) {
  const { month: curMonth, year: curYear } = currentMonthYear();
  let month = Number(query?.month);
  let year = Number(query?.year);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    month = curMonth;
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    year = curYear;
  }
  return { month, year };
}

/**
 * Derive the cash/upi paise portions for a validated payment body.
 * Split uses the submitted amounts; cash/upi derive from the total so the
 * stored cash_amount + upi_amount always equals amount (DB CHECK enforces it).
 */
export function paymentPortions(body) {
  const total = toPaise(body.amount);
  if (body.payment_mode === 'split') {
    return { cash: toPaise(body.cash_amount), upi: toPaise(body.upi_amount) };
  }
  if (body.payment_mode === 'upi') return { cash: 0, upi: total };
  return { cash: total, upi: 0 };
}
