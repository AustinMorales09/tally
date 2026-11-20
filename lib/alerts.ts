import { db, type Sub, type Txn } from "./db";
import { addDaysIso, PER } from "./cycles";
import { money } from "./time";
import { userSubs } from "./subs";

export type Alert = {
  key: string;
  kind: "after_cancel" | "price" | "trial" | "annual" | "duplicate";
  subId: number;
  title: string;
  detail: string;
  /** For a price change: the new amount, offered as a one-click update. */
  newAmount?: number;
};

const ORDER: Alert["kind"][] = ["after_cancel", "price", "trial", "annual", "duplicate"];
const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Things worth the user's attention today, from their subscriptions and imported charges. Dismissed ones are left out. */
export function computeAlerts(userId: number, today: string, subs: Sub[] = userSubs(userId)): Alert[] {
  const dismissed = new Set((db.prepare("SELECT alert_key FROM dismissed WHERE user_id = ?").all(userId) as { alert_key: string }[]).map((r) => r.alert_key));
  const latest = db.prepare("SELECT * FROM transactions WHERE sub_id = ? ORDER BY date DESC, id DESC LIMIT 1");
  const out: Alert[] = [];

  for (const s of subs) {
    if (s.status === "cancelled" && s.cancelled_on) {
      const after = db.prepare("SELECT * FROM transactions WHERE sub_id = ? AND date > ? ORDER BY date DESC, id DESC").all(s.id, s.cancelled_on) as Txn[];
      if (after.length) {
        const total = after.reduce((t, x) => t + x.amount_cents, 0);
        out.push({
          key: `after_cancel:${s.id}:${after[0].id}`, kind: "after_cancel", subId: s.id,
          title: `${s.name} charged you after you cancelled`,
          detail: `${after.length} charge${after.length === 1 ? "" : "s"} (${money(total)}) since you cancelled on ${fmt(s.cancelled_on)}, latest ${money(after[0].amount_cents)} on ${fmt(after[0].date)}. Check the cancellation went through and ask for a refund.`,
        });
      }
      continue;
    }
    const last = latest.get(s.id) as Txn | undefined;
    if (last && last.amount_cents !== s.amount_cents) {
      const up = last.amount_cents > s.amount_cents;
      out.push({
        key: `price:${s.id}:${last.id}`, kind: "price", subId: s.id,
        title: `${s.name} ${up ? "went up" : "changed"}: ${money(last.amount_cents)}`,
        detail: `Your latest charge on ${fmt(last.date)} was ${money(last.amount_cents)}, but you have ${money(s.amount_cents)} on file${up ? ` (${Math.round(((last.amount_cents - s.amount_cents) / s.amount_cents) * 100)}% more)` : ""}.`,
        newAmount: last.amount_cents,
      });
    }
    if (s.status === "trial" && s.trial_ends_on && s.trial_ends_on >= today && s.trial_ends_on <= addDaysIso(today, 3)) {
      out.push({
        key: `trial:${s.id}:${s.trial_ends_on}`, kind: "trial", subId: s.id,
        title: `${s.name} free trial ends ${s.trial_ends_on === today ? "today" : fmt(s.trial_ends_on)}`,
        detail: `After that it's ${money(s.amount_cents)} ${PER[s.cycle]}. Cancel before then if you don't want it.`,
      });
    }
    if (s.status === "active" && s.cycle === "yearly" && s.next_charge_on <= addDaysIso(today, 14)) {
      out.push({
        key: `annual:${s.id}:${s.next_charge_on}`, kind: "annual", subId: s.id,
        title: `${s.name} renews for a year on ${fmt(s.next_charge_on)}`,
        detail: `${money(s.amount_cents)} in one charge. Still using it?`,
      });
    }
  }

  // The same service tracked twice, or two plans from one merchant at about the same price.
  const live = subs.filter((s) => s.status !== "cancelled");
  const seen = new Set<number>();
  for (const a of live) {
    if (seen.has(a.id)) continue;
    const twins = live.filter((b) => b.id !== a.id && !seen.has(b.id) && (b.name.trim().toLowerCase() === a.name.trim().toLowerCase() || (a.merchant_key !== "" && b.merchant_key === a.merchant_key && Math.abs(a.amount_cents - b.amount_cents) <= a.amount_cents * 0.05)));
    if (!twins.length) continue;
    [a, ...twins].forEach((s) => seen.add(s.id));
    out.push({
      key: `duplicate:${[a, ...twins].map((s) => s.id).sort((x, y) => x - y).join("-")}`, kind: "duplicate", subId: a.id,
      title: `Possible duplicate: ${[a, ...twins].map((s) => s.name).join(" and ")}`,
      detail: "Two subscriptions look like the same service. If you're paying twice (two accounts, or one per family member), cancel one; otherwise dismiss this.",
    });
  }
  return out.filter((a) => !dismissed.has(a.key)).sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
}
