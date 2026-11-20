import { db, tx, type Sub, type Txn } from "./db";
import { rollForward } from "./cycles";
import { detectRecurring, type Candidate } from "./detect";

const copy = <T,>(r: unknown) => ({ ...(r as object) }) as T;

export function userSubs(userId: number): Sub[] {
  return (db.prepare("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY name COLLATE NOCASE").all(userId) as Sub[]).map((r) => copy<Sub>(r));
}

/**
 * Keeps billing dates current: a date in the past moves to the next one (assumed charged), and a free trial
 * whose end date has passed becomes active, billing from the day it ended.
 */
export function rollSubs(userId: number, today: string) {
  tx(() => {
    for (const s of userSubs(userId)) {
      if (s.status === "trial" && s.trial_ends_on && s.trial_ends_on < today) {
        const from = s.next_charge_on > s.trial_ends_on ? s.next_charge_on : s.trial_ends_on;
        db.prepare("UPDATE subscriptions SET status = 'active', next_charge_on = ? WHERE id = ?").run(rollForward(from, s.cycle, s.anchor_day, today), s.id);
      } else if (s.status === "active" && s.next_charge_on < today) {
        db.prepare("UPDATE subscriptions SET next_charge_on = ? WHERE id = ?").run(rollForward(s.next_charge_on, s.cycle, s.anchor_day, today), s.id);
      }
    }
  });
}

/** How far a charge may be from a subscription's price and still be "its" charge (price rises included). */
export const MATCH_TOLERANCE = 0.35;
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * MATCH_TOLERANCE;

/**
 * Re-links bank charges to subscriptions by merchant key. With several subscriptions under one merchant
 * (Apple, Google), a charge goes to the one with the closest price; charges far from every price stay unlinked.
 */
export function linkTransactions(userId: number) {
  const subs = userSubs(userId).filter((s) => s.merchant_key);
  const byKey = new Map<string, Sub[]>();
  subs.forEach((s) => byKey.set(s.merchant_key, [...(byKey.get(s.merchant_key) ?? []), s]));
  tx(() => {
    db.prepare("UPDATE transactions SET sub_id = NULL WHERE user_id = ? AND sub_id IS NOT NULL").run(userId);
    const set = db.prepare("UPDATE transactions SET sub_id = ? WHERE id = ?");
    for (const [key, list] of byKey) {
      const txns = db.prepare("SELECT id, amount_cents FROM transactions WHERE user_id = ? AND merchant_key = ?").all(userId, key) as Pick<Txn, "id" | "amount_cents">[];
      for (const t of txns) {
        const best = list.filter((s) => near(s.amount_cents, t.amount_cents)).sort((a, b) => Math.abs(a.amount_cents - t.amount_cents) - Math.abs(b.amount_cents - t.amount_cents))[0];
        if (best) set.run(best.id, t.id);
      }
    }
  });
}

/** Recurring charges found in the user's statements that aren't tracked or ignored yet. */
export function untrackedCandidates(userId: number): Candidate[] {
  const txns = db.prepare("SELECT id, date, amount_cents, merchant_key, description FROM transactions WHERE user_id = ? ORDER BY date").all(userId) as Txn[];
  const ignored = new Set((db.prepare("SELECT merchant_key FROM ignored_merchants WHERE user_id = ?").all(userId) as { merchant_key: string }[]).map((r) => r.merchant_key));
  const subs = userSubs(userId);
  return detectRecurring(txns.map((t) => copy<Txn>(t))).filter(
    (c) => !ignored.has(c.id) && !subs.some((s) => s.merchant_key === c.merchant_key && (c.amount_split === null || near(s.amount_cents, c.amount_cents))),
  );
}

export function linkedCharges(subId: number): Txn[] {
  return (db.prepare("SELECT * FROM transactions WHERE sub_id = ? ORDER BY date DESC, id DESC").all(subId) as Txn[]).map((r) => copy<Txn>(r));
}
