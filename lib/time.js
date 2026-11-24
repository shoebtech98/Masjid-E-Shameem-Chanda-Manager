// Asia/Kolkata business time — Safeguard 2.
//
// Workers run in UTC and the reference app used *server local time*. Every
// business-date decision must use the masjid's timezone (Asia/Kolkata by
// default, configurable via APP_TZ) — current date, current month/year,
// future-date validation, payment month boundaries, and every user-visible
// timestamp (audit, receipts, report "generated on").
//
// IST has no DST (fixed +05:30), but the offset is still derived from
// Intl so APP_TZ can be changed without breaking anything.

const DEFAULT_TZ = 'Asia/Kolkata';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

let APP_TZ = DEFAULT_TZ;
// Test seam: replace the clock so boundary tests can pin exact instants.
let clock = () => new Date();

export function configureTime({ tz, now } = {}) {
  if (tz) APP_TZ = tz;
  if (now) clock = now;
}
export function setClock(fn) { clock = fn; }
export function getTz() { return APP_TZ; }

const pad = (n) => String(n).padStart(2, '0');

/** Wall-clock components of an instant in APP_TZ. */
export function tzParts(date = clock()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

function offsetMinutes(date) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: APP_TZ, timeZoneName: 'longOffset' });
    const part = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName');
    const m = part?.value?.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3]));
  } catch {
    return 330; // Asia/Kolkata default
  }
}

/** Current month/year in APP_TZ (payment month boundary decisions). */
export function currentMonthYear(date = clock()) {
  const p = tzParts(date);
  return { month: p.month, year: p.year };
}

/** Today's date in APP_TZ as 'YYYY-MM-DD' (future-date guard). */
export function todayKey(date = clock()) {
  const p = tzParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Unambiguous ISO timestamp in APP_TZ (e.g. 2026-09-01T00:05:00+05:30) for
 * user-visible timestamps (audit log, receipts, report generated-on, entity
 * created_at/updated_at). Stored with the explicit offset so any client can
 * parse it correctly regardless of its own timezone.
 */
export function isoNow(date = clock()) {
  const p = tzParts(date);
  const off = offsetMinutes(date);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Month/year of an arbitrary stored instant (e.g. household.created_at), in APP_TZ. */
export function tzMonthOfInstant(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = tzParts(d);
  return { month: p.month, year: p.year };
}

/** Future-date guard: payment_date ('YYYY-MM-DD') must not exceed today in APP_TZ. */
export function isFuturePaymentDate(dateStr, date = clock()) {
  return dateStr > todayKey(date);
}

/** '16 August 2026' in APP_TZ (PDF "Generated on" / receipts). */
export function longDate(iso, date = clock()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = tzParts(d);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

export function monthLabel(month, year) {
  return `${MONTHS[month - 1]} ${year}`;
}

export { MONTHS };
