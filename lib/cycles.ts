import type { Cycle } from "./db";

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

export function addDaysIso(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The billing date `n` months after `date`, on the anchor day (clamped to short months: the 31st bills on Feb 28, then Mar 31). */
function monthsLater(date: string, n: number, anchor: number) {
  const [y, m] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(anchor, daysIn(ny, nm)))}`;
}

export const CYCLE_MONTHS: Partial<Record<Cycle, number>> = { monthly: 1, quarterly: 3, yearly: 12 };
export const CYCLE_DAYS: Record<Cycle, number> = { weekly: 7, biweekly: 14, monthly: 30.44, quarterly: 91.31, yearly: 365.25 };

/** The next billing date after `date`. */
export function addCycle(date: string, cycle: Cycle, anchor: number) {
  const months = CYCLE_MONTHS[cycle];
  return months ? monthsLater(date, months, anchor) : addDaysIso(date, CYCLE_DAYS[cycle]);
}

/** Moves a billing date forward until it's today or later. Returns it unchanged if it already is. */
export function rollForward(next: string, cycle: Cycle, anchor: number, today: string) {
  let d = next;
  for (let i = 0; d < today && i < 2000; i++) d = addCycle(d, cycle, anchor);
  return d;
}

/** The cost per month, for totals ("$15.49 monthly" + "$99 yearly" = $23.74/mo). */
// Charges per year: exact for calendar cycles, so "$36.99 a month" is exactly $443.88 a year.
const PER_YEAR: Record<Cycle, number> = { weekly: 365.25 / 7, biweekly: 365.25 / 14, monthly: 12, quarterly: 4, yearly: 1 };
export const monthlyCents = (amount: number, cycle: Cycle) => Math.round((amount * PER_YEAR[cycle]) / 12);
export const yearlyCents = (amount: number, cycle: Cycle) => Math.round(amount * PER_YEAR[cycle]);

/** Every billing date from `from` through `to` (inclusive), for the upcoming-charges list. */
export function chargesBetween(next: string, cycle: Cycle, anchor: number, from: string, to: string) {
  const out: string[] = [];
  let d = rollForward(next, cycle, anchor, from);
  for (let i = 0; d <= to && i < 400; i++) {
    out.push(d);
    d = addCycle(d, cycle, anchor);
  }
  return out;
}

/** "$15.49 a month" / "every 2 weeks". */
export const PER: Record<Cycle, string> = { weekly: "a week", biweekly: "every 2 weeks", monthly: "a month", quarterly: "every 3 months", yearly: "a year" };
