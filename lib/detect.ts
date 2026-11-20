// Finding recurring charges in a list of card/bank transactions. It is deliberately conservative: a
// suggestion needs a regular gap between charges, steady amounts and a recent charge, and every suggestion
// shows the charges it was based on. The user confirms; nothing is added automatically.

import type { Cycle } from "./db";
import { addCycle } from "./cycles";

export type DTxn = { id?: number; date: string; amount_cents: number; merchant_key: string; description: string };
export type Candidate = {
  id: string;                 // merchant key, or "key|amount" when one merchant bills several subscriptions
  merchant_key: string;
  amount_split: number | null;
  cycle: Cycle;
  amount_cents: number;       // the latest charge
  charges: { date: string; amount_cents: number; description: string }[];
  next_expected: string;
  anchor_day: number;
  price_change: { from: number; to: number; on: string } | null;
  confidence: "high" | "medium";
};

const CADENCES: { cycle: Cycle; min: number; max: number; minCount: number }[] = [
  { cycle: "weekly", min: 6, max: 8, minCount: 4 },
  { cycle: "biweekly", min: 12, max: 16, minCount: 3 },
  { cycle: "monthly", min: 25, max: 36, minCount: 3 },
  { cycle: "quarterly", min: 80, max: 101, minCount: 3 },
  { cycle: "yearly", min: 350, max: 381, minCount: 2 },
];
const STALE_FACTOR = 1.6; // a monthly charge not seen for ~49 days before the statement ends has probably stopped

const days = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400_000);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mode = (xs: number[]) => {
  const counts = new Map<number, number>();
  xs.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
};

/** Tests one series of charges (sorted by date). Returns null if it doesn't look like a subscription. */
function analyze(txns: DTxn[], statementEnd: string): Omit<Candidate, "id" | "merchant_key" | "amount_split"> | null {
  // Two charges on the same day (a refund-and-recharge, a split payment) count once for timing.
  const series = txns.filter((t, i) => i === 0 || t.date !== txns[i - 1].date);
  if (series.length < 2) return null;
  const gaps = series.slice(1).map((t, i) => days(series[i].date, t.date));
  const med = median(gaps);
  const cadence = CADENCES.find((c) => med >= c.min && med <= c.max);
  if (!cadence || series.length < cadence.minCount) return null;
  const regular = gaps.filter((g) => g >= cadence.min && g <= cadence.max).length;
  if (regular / gaps.length < 0.8) return null;

  // Amounts: steady, allowing a price change now and then (each step within 35%).
  const amounts = series.map((t) => t.amount_cents);
  const steps = amounts.slice(1).map((a, i) => Math.abs(a - amounts[i]) / amounts[i]);
  if (steps.filter((s) => s <= 0.35).length / steps.length < 0.8) return null;
  const changes = steps.filter((s) => s > 0).length;
  if (changes > Math.max(1, Math.floor(steps.length / 3))) return null; // amounts that move every time are spending, not a subscription

  const last = series[series.length - 1];
  const period = { weekly: 7, biweekly: 14, monthly: 30.44, quarterly: 91.3, yearly: 365.25 }[cadence.cycle];
  if (days(last.date, statementEnd) > period * STALE_FACTOR) return null; // stopped

  const anchor = mode(series.slice(-6).map((t) => Number(t.date.slice(8, 10))));
  let next = addCycle(last.date, cadence.cycle, anchor);
  if (cadence.cycle !== "weekly" && cadence.cycle !== "biweekly" && days(last.date, next) < cadence.min - 3) next = addCycle(next, cadence.cycle, anchor);
  // The most recent price change, however many charges ago it was.
  let ci = series.length - 1;
  while (ci > 0 && series[ci - 1].amount_cents === last.amount_cents) ci--;
  return {
    cycle: cadence.cycle,
    amount_cents: last.amount_cents,
    charges: series.map((t) => ({ date: t.date, amount_cents: t.amount_cents, description: t.description })),
    next_expected: next,
    anchor_day: anchor,
    price_change: ci > 0 ? { from: series[ci - 1].amount_cents, to: last.amount_cents, on: series[ci].date } : null,
    confidence: changes === 0 && regular === gaps.length ? "high" : "medium",
  };
}

/** Recurring series in these transactions, biggest yearly cost first. */
export function detectRecurring(txns: DTxn[], statementEnd?: string): Candidate[] {
  if (!txns.length) return [];
  const end = statementEnd ?? txns.reduce((m, t) => (t.date > m ? t.date : m), txns[0].date);
  const groups = new Map<string, DTxn[]>();
  for (const t of txns) groups.set(t.merchant_key, [...(groups.get(t.merchant_key) ?? []), t]);
  const out: Candidate[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.amount_cents - b.amount_cents);
    const whole = analyze(list, end);
    if (whole) {
      out.push({ id: key, merchant_key: key, amount_split: null, ...whole });
      continue;
    }
    // One merchant, several plans (Apple, Google, Amazon bill many things under one name): try each amount.
    const byAmount = new Map<number, DTxn[]>();
    for (const t of list) byAmount.set(t.amount_cents, [...(byAmount.get(t.amount_cents) ?? []), t]);
    for (const [amount, same] of byAmount) {
      const r = same.length >= 2 ? analyze(same, end) : null;
      if (r) out.push({ id: `${key}|${amount}`, merchant_key: key, amount_split: amount, ...r });
    }
  }
  const yearly = (c: Candidate) => c.amount_cents * (365.25 / { weekly: 7, biweekly: 14, monthly: 30.44, quarterly: 91.3, yearly: 365.25 }[c.cycle]);
  return out.sort((a, b) => yearly(b) - yearly(a));
}
