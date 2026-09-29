const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Local calendar date, not UTC. A run late in the evening in a UTC+ zone,
 * or early morning in a UTC- zone, must not report tomorrow's or yesterday's date. */
export function todayISO(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toUTC(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

/** Whole days from `from` to `to`. Positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  return new Date(toUTC(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Parse "October 23, 2026", "Oct 23, 2026", "2026-10-23" or "23 October 2026" into ISO. */
export function parseLooseDate(text: string): string | null {
  const trimmed: string = text.trim();
  if (ISO_DATE.test(trimmed)) return isISODate(trimmed) ? trimmed : null;
  const months: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    sept: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const mdy = trimmed.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  const dmy = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/);
  let month: number | undefined;
  let day: number | undefined;
  let year: number | undefined;
  if (mdy) {
    month = months[mdy[1]!.toLowerCase().slice(0, 4)] ?? months[mdy[1]!.toLowerCase().slice(0, 3)];
    day = Number(mdy[2]);
    year = Number(mdy[3]);
  } else if (dmy) {
    month = months[dmy[2]!.toLowerCase().slice(0, 4)] ?? months[dmy[2]!.toLowerCase().slice(0, 3)];
    day = Number(dmy[1]);
    year = Number(dmy[3]);
  }
  if (!month || !day || !year) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isISODate(iso) ? iso : null;
}
