import { db, type User } from "./db";
import { addDaysIso, PER } from "./cycles";
import { appUrl, sendEmail } from "./mail";
import { rollSubs, userSubs } from "./subs";
import { localDateOf, money } from "./time";

const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Reminders before a charge (each subscription's own "remind me N days before") and before a free trial ends
 * (3 days). One email per user per run lists everything due; each item is logged by key, so it's sent once.
 * A date that has already passed is never reminded about (if the server was down, a late reminder is noise).
 */
export async function runReminders(now = Date.now()) {
  const users = (db.prepare("SELECT * FROM users WHERE email_reminders = 1").all() as User[]).map((u) => ({ ...u }));
  const logged = db.prepare("SELECT 1 FROM reminder_log WHERE user_id = ? AND reminder_key = ?");
  const log = db.prepare("INSERT OR IGNORE INTO reminder_log (user_id, reminder_key, sent_at) VALUES (?, ?, ?)");
  for (const u of users) {
    const today = localDateOf(now, u.timezone);
    rollSubs(u.id, today);
    const items: { key: string; line: string }[] = [];
    for (const s of userSubs(u.id)) {
      if (s.status === "trial" && s.trial_ends_on && s.trial_ends_on >= today && s.trial_ends_on <= addDaysIso(today, 3)) {
        items.push({ key: `trial:${s.id}:${s.trial_ends_on}`, line: `- ${s.name}: free trial ends ${s.trial_ends_on === today ? "TODAY" : fmt(s.trial_ends_on)}. Then ${money(s.amount_cents)} ${PER[s.cycle]}.${s.cancel_url ? ` Cancel: ${s.cancel_url}` : ""}` });
      } else if (s.status === "active" && s.remind_days > 0 && s.next_charge_on >= today && s.next_charge_on <= addDaysIso(today, s.remind_days)) {
        items.push({ key: `charge:${s.id}:${s.next_charge_on}`, line: `- ${s.name}: ${money(s.amount_cents)} on ${s.next_charge_on === today ? "today" : fmt(s.next_charge_on)}${s.payment_label ? ` (${s.payment_label})` : ""}.${s.cancel_url ? ` Cancel: ${s.cancel_url}` : ""}` });
      }
    }
    const fresh = items.filter((i) => !logged.get(u.id, i.key));
    if (!fresh.length) continue;
    const trials = fresh.filter((i) => i.key.startsWith("trial:")).length;
    const subject = trials ? `${trials === 1 ? "A free trial ends" : `${trials} free trials end`} soon` : `${fresh.length === 1 ? "A subscription renews" : `${fresh.length} subscriptions renew`} soon`;
    // Log first: a crash between sending and logging should skip a reminder, not repeat it every minute.
    for (const i of fresh) log.run(u.id, i.key, now);
    await sendEmail({
      userId: u.id,
      to: u.email,
      subject,
      body: `Hi${u.name ? ` ${u.name}` : ""},\n\nComing up:\n${fresh.map((i) => i.line).join("\n")}\n\nSee everything: ${appUrl()}/dashboard\nTurn these emails off in Settings, or change "remind me" on each subscription.`,
    });
  }
}
