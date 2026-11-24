// Monetary helpers — exact copy of the reference lib/amounts.js.
//
// All amounts are stored as INTEGER paise (1 rupee = 100 paise) in the
// database so that every calculation is exact integer arithmetic — no
// floating-point rounding errors in financial records.

const RUPEES_RE = /^\d+(\.\d{1,2})?$/;

/**
 * Parse a user-entered rupee amount into integer paise.
 * Accepts "500", "500.50", "₹500", "1,200.75" (strips ₹, commas, spaces).
 * Returns null when the input is not a valid positive amount.
 */
export function toPaise(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/[₹,\s]/g, '');
  if (!RUPEES_RE.test(s)) return null;
  const [whole = '0', frac = ''] = s.split('.');
  const w = parseInt(whole, 10);
  const f = parseInt((frac + '00').slice(0, 2), 10);
  if (!Number.isSafeInteger(w)) return null;
  return w * 100 + f;
}

/** Integer paise -> "₹500" / "₹12.34" (Indian digit grouping). */
export function formatRupees(paise) {
  const n = Number(paise) || 0;
  const hasPaise = n % 100 !== 0;
  const value = (n / 100).toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `₹${value}`;
}
