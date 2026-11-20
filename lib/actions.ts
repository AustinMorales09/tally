"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession, hashPassword, verifyPassword } from "./auth";
import { me, ownSub } from "./access";
import { CATEGORIES, CYCLES, db, tx, type Cycle, type Sub, type SubStatus } from "./db";
import { loadDemo } from "./demo";
import { importStatement } from "./importer";
import { validEmail } from "./mail";
import { displayName, merchantKey } from "./merchant";
import { parseAmount, type DateFormat, type SignMode } from "./statement";
import { linkTransactions, untrackedCandidates } from "./subs";
import { isDate } from "./time";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const q = (m: string) => encodeURIComponent(m);
const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return !!tz;
  } catch {
    return false;
  }
};
const stamp = () => Date.now().toString(36);

// ---------- auth & settings ----------

export async function signup(form: FormData) {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  const name = str(form, "name").slice(0, 60);
  const tz = validTz(str(form, "timezone")) ? str(form, "timezone") : "America/New_York";
  if (!validEmail(email)) redirect(`/signup?error=${q("Enter a valid email")}`);
  if (password.length < 8) redirect(`/signup?error=${q("Password must be at least 8 characters")}`);
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) redirect(`/signup?error=${q("That email is already registered")}`);
  const id = Number(db.prepare("INSERT INTO users (email, password_hash, name, timezone, created_at) VALUES (?, ?, ?, ?, ?)").run(email, hashPassword(password), name, tz, Date.now()).lastInsertRowid);
  await createSession(id);
  redirect("/dashboard?welcome=1");
}

export async function login(form: FormData) {
  const email = str(form, "email").toLowerCase();
  const user = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email) as { id: number; password_hash: string } | undefined;
  if (!user || !verifyPassword(str(form, "password"), user.password_hash)) redirect(`/login?error=${q("Wrong email or password")}`);
  await createSession(user.id);
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/");
}

export async function saveSettings(form: FormData) {
  const { user } = await me();
  const tz = str(form, "timezone");
  const days = Number(str(form, "default_remind_days"));
  if (!validTz(tz)) redirect(`/settings?error=${q("Choose a valid time zone")}`);
  if (!Number.isInteger(days) || days < 0 || days > 30) redirect(`/settings?error=${q("Reminder days: 0 to 30")}`);
  db.prepare("UPDATE users SET name = ?, timezone = ?, email_reminders = ?, default_remind_days = ? WHERE id = ?").run(str(form, "name").slice(0, 60), tz, form.get("email_reminders") ? 1 : 0, days, user.id);
  redirect(`/settings?saved=${stamp()}`);
}

// ---------- subscriptions ----------

const STATUSES: SubStatus[] = ["active", "trial", "paused", "cancelled"];

/** Card numbers don't belong here: only a label like "Visa ••4242" or "Amex (work)". */
const looksLikeCardNumber = (s: string) => /\d[\d\s-]{6,}\d/.test(s);

export async function saveSub(form: FormData) {
  const id = Number(form.get("sub_id")) || null;
  const owned = id ? await ownSub(id) : null;
  const { user, today } = owned ?? (await me());
  const before: Sub | null = owned?.sub ?? null;
  const back = id ? `/subscriptions/${id}` : "/subscriptions/new";
  const fail = (m: string) => redirect(`${back}?error=${q(m)}`);

  const name = str(form, "name").slice(0, 80);
  const amount = parseAmount(str(form, "amount"));
  const cycle = str(form, "cycle") as Cycle;
  const status = str(form, "status") as SubStatus;
  const next = str(form, "next_charge_on");
  const trialEnds = str(form, "trial_ends_on");
  const cancelUrl = str(form, "cancel_url");
  const label = str(form, "payment_label").slice(0, 40);
  const remind = Number(str(form, "remind_days") || user.default_remind_days);
  const category = CATEGORIES.includes(str(form, "category")) ? str(form, "category") : "Other";
  const bankText = str(form, "bank_text");

  if (!name) fail("Give it a name");
  if (amount === null || amount <= 0 || amount > 10_000_000) fail("Enter the price, e.g. 15.49");
  if (!CYCLES.includes(cycle)) fail("Choose how often it bills");
  if (!STATUSES.includes(status)) fail("Choose a status");
  if (!isDate(next)) fail("Enter the next billing date");
  if (status === "trial" && !isDate(trialEnds)) fail("Enter when the free trial ends");
  if (cancelUrl && !/^https?:\/\/[^\s]+$/i.test(cancelUrl)) fail("The cancel link must start with https://");
  if (looksLikeCardNumber(label)) fail("Don't enter a card number. A label like “Visa ••4242” is enough.");
  if (!Number.isInteger(remind) || remind < 0 || remind > 30) fail("Remind me: 0 to 30 days before");

  // Billing day: from the date entered, except when an edit leaves the date alone (a 31st plan showing Feb 28 stays on the 31st).
  const anchor = before && before.next_charge_on === next ? before.anchor_day : Number(next.slice(8, 10));
  const values = [
    name, amount, cycle, next, anchor, category, status, status === "trial" ? trialEnds : null,
    cancelUrl.slice(0, 300), label, bankText ? merchantKey(bankText) : "", remind, str(form, "notes").slice(0, 1000),
  ];
  let subId = id;
  if (id) {
    const cancelledOn = status === "cancelled" ? (before?.cancelled_on ?? today) : null;
    db.prepare(
      `UPDATE subscriptions SET name = ?, amount_cents = ?, cycle = ?, next_charge_on = ?, anchor_day = ?, category = ?, status = ?, trial_ends_on = ?,
         cancel_url = ?, payment_label = ?, merchant_key = ?, remind_days = ?, notes = ?, cancelled_on = ? WHERE id = ?`,
    ).run(...values, cancelledOn, id);
  } else {
    subId = Number(db.prepare(
      `INSERT INTO subscriptions (name, amount_cents, cycle, next_charge_on, anchor_day, category, status, trial_ends_on, cancel_url, payment_label, merchant_key, remind_days, notes, cancelled_on, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...values, status === "cancelled" ? today : null, user.id, Date.now()).lastInsertRowid);
  }
  linkTransactions(user.id);
  redirect(`/subscriptions/${subId}?saved=${stamp()}`);
}

export async function cancelSub(form: FormData) {
  const { sub, today } = await ownSub(Number(form.get("sub_id")));
  const on = str(form, "cancelled_on") || today;
  if (!isDate(on) || on > today) redirect(`/subscriptions/${sub.id}?error=${q("Enter the date you cancelled (today or earlier)")}`);
  db.prepare("UPDATE subscriptions SET status = 'cancelled', cancelled_on = ? WHERE id = ?").run(on, sub.id);
  redirect(`/subscriptions/${sub.id}?cancelled=${stamp()}`);
}

export async function reactivateSub(form: FormData) {
  const { sub } = await ownSub(Number(form.get("sub_id")));
  db.prepare("UPDATE subscriptions SET status = 'active', cancelled_on = NULL WHERE id = ?").run(sub.id);
  redirect(`/subscriptions/${sub.id}?saved=${stamp()}`);
}

export async function deleteSub(form: FormData) {
  const { sub, user } = await ownSub(Number(form.get("sub_id")));
  db.prepare("DELETE FROM subscriptions WHERE id = ?").run(sub.id);
  linkTransactions(user.id);
  redirect(`/subscriptions?deleted=${stamp()}`);
}

export async function updateAmount(form: FormData) {
  const { sub } = await ownSub(Number(form.get("sub_id")));
  const amount = Number(form.get("amount"));
  if (!Number.isInteger(amount) || amount <= 0) redirect("/dashboard");
  db.prepare("UPDATE subscriptions SET amount_cents = ? WHERE id = ?").run(amount, sub.id);
  redirect(`${str(form, "back") === "sub" ? `/subscriptions/${sub.id}` : "/dashboard"}?updated=${stamp()}`);
}

export async function dismissAlert(form: FormData) {
  const { user } = await me();
  const key = str(form, "key").slice(0, 120);
  if (key) db.prepare("INSERT OR IGNORE INTO dismissed (user_id, alert_key) VALUES (?, ?)").run(user.id, key);
  redirect(`/dashboard?dismissed=${stamp()}`);
}

// ---------- statements ----------

export async function importCsv(form: FormData) {
  const { user } = await me();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(`/import?error=${q("Choose a CSV file exported from your bank or card")}`);
  if (file.size > 5 * 1024 * 1024) redirect(`/import?error=${q("That file is over 5 MB. Export 12–15 months instead.")}`);
  const head = new Uint8Array(await file.slice(0, 4000).arrayBuffer());
  if (head.includes(0) || /^%PDF|^PK/.test(new TextDecoder().decode(head.slice(0, 4)))) redirect(`/import?error=${q("That isn't a CSV file. In your bank's website, look for Download or Export → CSV.")}`);
  const dateFormat = (["auto", "mdy", "dmy", "ymd"].includes(str(form, "date_format")) ? str(form, "date_format") : "auto") as DateFormat;
  const sign = (["auto", "negative", "positive"].includes(str(form, "sign")) ? str(form, "sign") : "auto") as SignMode;
  const r = importStatement(user.id, file.name, await file.text(), { dateFormat, sign });
  if ("error" in r) redirect(`/import?error=${q(r.error)}`);
  redirect(`/review?import=${r.importId}&added=${r.added}&dup=${r.duplicates}&skipped=${r.skipped}&in=${r.incoming}&out=${q(r.outIs)}&fmt=${r.dateFormat}`);
}

export async function deleteImport(form: FormData) {
  const { user } = await me();
  db.prepare("DELETE FROM imports WHERE id = ? AND user_id = ?").run(Number(form.get("import_id")), user.id);
  redirect(`/import?removed=${stamp()}`);
}

export async function confirmCandidate(form: FormData) {
  const { user } = await me();
  const c = untrackedCandidates(user.id).find((x) => x.id === str(form, "candidate"));
  if (!c) redirect("/review");
  const name = str(form, "name").slice(0, 80) || displayName(c.merchant_key);
  const category = CATEGORIES.includes(str(form, "category")) ? str(form, "category") : "Other";
  tx(() => {
    db.prepare(
      `INSERT INTO subscriptions (user_id, name, amount_cents, cycle, next_charge_on, anchor_day, category, merchant_key, remind_days, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(user.id, name, c.amount_cents, c.cycle, c.next_expected, c.anchor_day, category, c.merchant_key, user.default_remind_days, Date.now());
  });
  linkTransactions(user.id);
  redirect(`/review?added_name=${q(name)}&t=${stamp()}`);
}

export async function ignoreCandidate(form: FormData) {
  const { user } = await me();
  const id = str(form, "candidate").slice(0, 120);
  if (id) db.prepare("INSERT OR IGNORE INTO ignored_merchants (user_id, merchant_key) VALUES (?, ?)").run(user.id, id);
  redirect(`/review?ignored=${stamp()}`);
}

export async function unignoreAll() {
  const { user } = await me();
  db.prepare("DELETE FROM ignored_merchants WHERE user_id = ?").run(user.id);
  redirect(`/review?t=${stamp()}`);
}

export async function demo() {
  const { user, today } = await me();
  if ((db.prepare("SELECT COUNT(*) AS n FROM imports WHERE user_id = ? AND filename = 'sample-checking.csv'").get(user.id) as { n: number }).n) redirect("/review");
  loadDemo(user.id, today);
  redirect(`/review?demo=1&t=${stamp()}`);
}
