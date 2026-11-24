// Unit tests for 24-subscription-tracker.
import assert from "node:assert/strict";
const { db } = await import("./lib/db.ts");
const C = await import("./lib/cycles.ts");
const St = await import("./lib/statement.ts");
const M = await import("./lib/merchant.ts");
const { detectRecurring } = await import("./lib/detect.ts");
const { demoStatement, loadDemo } = await import("./lib/demo.ts");
const { importStatement } = await import("./lib/importer.ts");
const Subs = await import("./lib/subs.ts");
const { computeAlerts } = await import("./lib/alerts.ts");
const { runReminders } = await import("./lib/notify.ts");

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("✓", name); };
const TODAY = "2026-11-14";

await ok("billing dates: the 31st clamps to short months and comes back; rolling forward; monthly cost", () => {
  assert.equal(C.addCycle("2026-01-31", "monthly", 31), "2026-02-28");
  assert.equal(C.addCycle("2026-02-28", "monthly", 31), "2026-03-31");
  assert.equal(C.addCycle("2028-01-31", "monthly", 31), "2028-02-29");
  assert.equal(C.addCycle("2024-02-29", "yearly", 29), "2025-02-28");
  assert.equal(C.addCycle("2026-11-10", "biweekly", 10), "2026-11-24");
  assert.equal(C.rollForward("2026-01-31", "monthly", 31, TODAY), "2026-11-30");
  assert.equal(C.rollForward("2026-11-14", "monthly", 14, TODAY), "2026-11-14");
  assert.equal(C.monthlyCents(12000, "yearly"), 1000);
  assert.equal(C.monthlyCents(1000, "weekly"), 4348);
  assert.equal(C.yearlyCents(3699, "monthly"), 44388);
  assert.equal(C.monthlyCents(2500, "quarterly"), 833);
  assert.deepEqual(C.chargesBetween("2026-10-30", "weekly", 30, TODAY, "2026-11-30"), ["2026-11-20", "2026-11-27"]);
});

await ok("statement CSV: preamble, debit/credit columns, (parens), trailing minus, day-first dates detected", () => {
  const credit = "Account: Everyday Checking ****1234\nExported 2026-11-14\n\nDate,Payee,Debit,Credit\n31/10/2026,NETFLIX.COM,15.49,\n01/11/2026,SALARY,,3000.00\n02/11/2026,\"Coffee, Co\",\"1,204.50\",\n";
  const r = St.parseStatement(credit);
  assert.equal(r.dateFormat, "dmy");
  assert.equal(r.outIs, "debit column");
  assert.deepEqual(r.txns, [{ date: "2026-10-31", description: "NETFLIX.COM", amount_cents: 1549 }, { date: "2026-11-02", description: "Coffee, Co", amount_cents: 120450 }]);
  assert.equal(r.incoming, 1);
  assert.equal(St.parseAmount("(12.00)"), -1200);
  assert.equal(St.parseAmount("12.00-"), -1200);
  assert.equal(St.parseAmount("USD -3.5"), -350);
  assert.equal(St.parseAmount("abc"), null);
  assert.equal(St.parseDate("Jan 5, 2026", "mdy"), "2026-01-05");
  assert.equal(St.parseDate("05-Jan-26", "mdy"), "2026-01-05");
  assert.equal(St.parseDate("02/30/2026", "mdy"), null);
});

await ok("statement CSV: card exports with purchases as positive numbers are read the right way round", () => {
  const card = "Transaction Date,Description,Amount\n11/01/2026,SPOTIFY,11.99\n11/02/2026,WHOLE FOODS,54.20\n11/03/2026,PAYMENT THANK YOU,-500.00\n";
  const r = St.parseStatement(card);
  assert.equal(r.outIs, "positive");
  assert.deepEqual(r.txns.map((t) => t.description), ["SPOTIFY", "WHOLE FOODS"]);
  assert.equal(St.parseStatement(card, { sign: "negative" }).txns[0].description, "PAYMENT THANK YOU");
  assert.match(St.parseStatement("foo,bar\n1,2").error, /header row/);
});

await ok("merchant keys: phone numbers, store numbers, processors and locations don't split a merchant", () => {
  const same = (a, b) => assert.equal(M.merchantKey(a), M.merchantKey(b), `${a} vs ${b}`);
  same("NETFLIX.COM 866-579-7172 CA", "NETFLIX.COM 866-716-0414 CA");
  same("Spotify USA 877-778-1161", "SPOTIFY P2C4E8A11");
  same("PLANET FITNESS #1234 AUSTIN TX", "PLANET FITNESS #5678 AUSTIN TX");
  assert.equal(M.merchantKey("PAYPAL *ADOBE 4029357733"), "ADOBE");
  assert.equal(M.merchantKey("POS DEBIT NETFLIX.COM"), "NETFLIX");
  assert.equal(M.merchantKey("CLAUDE.AI SUBSCRIPTION"), "CLAUDE");
  assert.equal(M.merchantKey("PLANET FITNESS MONTHLY MEMBERSHIP"), "PLANET FITNESS");
  assert.equal(M.merchantKey("SQ *BLUE BOTTLE COFFEE"), "BLUE BOTTLE COFFEE");
  assert.equal(M.merchantKey("AMZN Mktp US*2K4RT5"), "AMZN MKTP");
  assert.equal(M.guessCategory("NETFLIX"), "Streaming");
  assert.equal(M.displayName("PLANET FITNESS AUSTIN"), "Planet Fitness Austin");
});

const demo = St.parseStatement(demoStatement(TODAY)).txns.map((t) => ({ ...t, merchant_key: M.merchantKey(t.description) }));
const found = detectRecurring(demo);
const by = (id) => found.find((c) => c.id === id);

await ok("detection on 13 months of real-looking spending: finds the subscriptions, ignores everyday spending", () => {
  const ids = found.map((c) => c.id).sort();
  assert.deepEqual(ids, ["ADOBE", "APPLE BILL|1099", "APPLE BILL|299", "HULU", "NAMECHEAP", "NETFLIX", "PLANET FITNESS AUSTIN", "SPOTIFY", "MORGAN PROPERTIES"].sort());
  for (const not of ["WHOLEFDS MKT AUSTIN", "BLUE BOTTLE COFFEE", "AMZN MKTP", "SHELL OIL", "CITY OF AUSTIN", "CHASE CREDIT CRD", "HELLOFRESH"]) assert.ok(!found.some((c) => c.merchant_key.startsWith(not)), not);
  assert.equal(found[0].id, "MORGAN PROPERTIES"); // biggest yearly cost first
});

await ok("detection details: cadence, next date, anchor day, price change, confidence, one merchant with two plans", () => {
  const nf = by("NETFLIX");
  assert.equal(nf.cycle, "monthly");
  assert.equal(nf.amount_cents, 1799);
  assert.deepEqual(nf.price_change, { from: 1549, to: 1799, on: "2026-09-05" });
  assert.equal(nf.next_expected, "2026-12-05");
  assert.equal(nf.confidence, "medium");
  assert.equal(by("SPOTIFY").confidence, "high");
  assert.equal(by("APPLE BILL|299").next_expected, "2026-11-20");
  assert.equal(by("APPLE BILL|1099").next_expected, "2026-12-03");
  const nc = by("NAMECHEAP");
  assert.equal(nc.cycle, "yearly");
  assert.equal(nc.next_expected, "2027-11-07");
});

await ok("detection rejects: irregular gaps, a single charge, a series that stopped, amounts that change every time", () => {
  const mk = (dates, amounts) => dates.map((d, i) => ({ date: d, amount_cents: amounts[i] ?? amounts[0], merchant_key: "X", description: "X" }));
  assert.equal(detectRecurring(mk(["2026-01-03", "2026-01-20", "2026-03-02", "2026-03-09"], [1000])).length, 0);
  assert.equal(detectRecurring(mk(["2026-01-03"], [1000])).length, 0);
  assert.equal(detectRecurring(mk(["2026-01-03", "2026-02-03", "2026-03-03"], [1000]), "2026-06-01").length, 0);
  assert.equal(detectRecurring(mk(["2026-01-03", "2026-02-03", "2026-03-03", "2026-04-03"], [1000, 1100, 1210, 1050])).length, 0);
  assert.equal(detectRecurring(mk(["2026-01-03", "2026-02-04", "2026-03-02", "2026-04-03"], [1000])).length, 1);
});

// ---------- with a database ----------
const now = Date.now();
db.prepare("INSERT INTO users (id, email, password_hash, name, timezone, created_at) VALUES (1, 'a@b.co', 'x', 'Alex', 'UTC', ?)").run(now);
db.prepare("INSERT INTO users (id, email, password_hash, name, timezone, created_at) VALUES (2, 'c@d.co', 'x', 'Sam', 'UTC', ?)").run(now);

await ok("import: overlapping statements don't double charges; two identical charges on one day are both kept", () => {
  const csv = "Date,Description,Amount\n2026-10-01,SPOTIFY,-11.99\n2026-10-02,COFFEE,-4.00\n2026-10-02,COFFEE,-4.00\n";
  const a = importStatement(2, "a.csv", csv);
  assert.equal(a.added, 3);
  const b = importStatement(2, "b.csv", csv + "2026-11-01,SPOTIFY,-11.99\n");
  assert.equal(b.added, 1);
  assert.equal(b.duplicates, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = 2").get().n, 4);
});

await ok("sample data: candidates exclude what's tracked; alerts for charged-after-cancel and an ending trial", () => {
  loadDemo(1, TODAY);
  const cands = Subs.untrackedCandidates(1).map((c) => c.id);
  assert.ok(!cands.includes("HULU"), "the cancelled Hulu subscription covers it");
  assert.ok(cands.includes("NETFLIX"));
  const alerts = computeAlerts(1, TODAY);
  assert.deepEqual(alerts.map((a) => a.kind), ["after_cancel", "trial"]);
  assert.match(alerts[0].detail, /^2 charges \(\$37\.98\) since you cancelled on Sep 25, 2026, latest \$18\.99 on Oct 26, 2026/);
});

const confirm = (c, name) => Number(db.prepare(
  "INSERT INTO subscriptions (user_id, name, amount_cents, cycle, next_charge_on, anchor_day, merchant_key, created_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)",
).run(name, c.amount_cents, c.cycle, c.next_expected, c.anchor_day, c.merchant_key, now).lastInsertRowid);

await ok("linking: two Apple plans each get their own charges; a price rise shows as an alert until the amount is updated", () => {
  const c = Object.fromEntries(Subs.untrackedCandidates(1).map((x) => [x.id, x]));
  const icloud = confirm(c["APPLE BILL|299"], "iCloud+");
  const music = confirm(c["APPLE BILL|1099"], "Apple Music");
  const nf = confirm({ ...c["NETFLIX"], amount_cents: 1549 }, "Netflix"); // entered at the old price
  Subs.linkTransactions(1);
  const amounts = (id) => [...new Set(Subs.linkedCharges(id).map((t) => t.amount_cents))];
  assert.deepEqual(amounts(icloud), [299]);
  assert.deepEqual(amounts(music), [1099]);
  assert.deepEqual(amounts(nf).sort(), [1549, 1799]);
  assert.ok(!Subs.untrackedCandidates(1).some((x) => x.merchant_key === "APPLE BILL" || x.id === "NETFLIX"));
  const price = computeAlerts(1, TODAY).find((a) => a.kind === "price");
  assert.equal(price.newAmount, 1799);
  assert.match(price.title, /Netflix went up: \$17\.99/);
  db.prepare("UPDATE subscriptions SET amount_cents = 1799 WHERE id = ?").run(nf);
  assert.ok(!computeAlerts(1, TODAY).some((a) => a.kind === "price"));
});

await ok("alerts: duplicates, yearly renewal heads-up, dismissals stick", () => {
  db.prepare("INSERT INTO subscriptions (user_id, name, amount_cents, cycle, next_charge_on, anchor_day, created_at) VALUES (1, 'netflix ', 1799, 'monthly', '2026-12-05', 5, ?)").run(now);
  db.prepare("INSERT INTO subscriptions (user_id, name, amount_cents, cycle, next_charge_on, anchor_day, created_at) VALUES (1, 'Domain', 1798, 'yearly', '2026-11-20', 20, ?)").run(now);
  const a = computeAlerts(1, TODAY);
  const dup = a.find((x) => x.kind === "duplicate");
  assert.match(dup.title, /Netflix and netflix/);
  assert.ok(a.some((x) => x.kind === "annual" && /Domain renews for a year on Nov 20, 2026/.test(x.title)));
  db.prepare("INSERT INTO dismissed (user_id, alert_key) VALUES (1, ?)").run(dup.key);
  assert.ok(!computeAlerts(1, TODAY).some((x) => x.kind === "duplicate"));
});

await ok("rolling: past billing dates move forward; an ended trial becomes active from its end date", () => {
  const id = Number(db.prepare("INSERT INTO subscriptions (user_id, name, amount_cents, cycle, next_charge_on, anchor_day, status, trial_ends_on, created_at) VALUES (2, 'Trial', 500, 'monthly', '2026-10-31', 31, 'trial', '2026-10-31', ?)").run(now).lastInsertRowid);
  const id2 = Number(db.prepare("INSERT INTO subscriptions (user_id, name, amount_cents, cycle, next_charge_on, anchor_day, created_at) VALUES (2, 'Old', 500, 'monthly', '2026-06-30', 31, ?)").run(now).lastInsertRowid);
  Subs.rollSubs(2, TODAY);
  const get = (i) => db.prepare("SELECT status, next_charge_on FROM subscriptions WHERE id = ?").get(i);
  assert.deepEqual({ ...get(id) }, { status: "active", next_charge_on: "2026-11-30" });
  assert.deepEqual({ ...get(id2) }, { status: "active", next_charge_on: "2026-11-30" });
});

await ok("reminders: one email listing what's due, each item sent once, nothing for past dates or with reminders off", async () => {
  db.prepare("DELETE FROM subscriptions WHERE user_id = 2").run();
  const add = (name, next, extra = "") => db.prepare(`INSERT INTO subscriptions (user_id, name, amount_cents, cycle, next_charge_on, anchor_day, remind_days, cancel_url, payment_label, created_at) VALUES (2, ?, 1000, 'monthly', ?, 15, 3, ?, ?, ?)`).run(name, next, extra, "Visa ••4242", now);
  add("Gym", "2026-11-16", "https://gym.example/cancel");
  add("Later", "2026-11-25");
  db.prepare("INSERT INTO subscriptions (user_id, name, amount_cents, cycle, next_charge_on, anchor_day, status, trial_ends_on, created_at) VALUES (2, 'Max', 1699, 'monthly', '2026-11-15', 15, 'trial', '2026-11-15', ?)").run(now);
  const at = Date.parse("2026-11-14T15:00:00Z");
  await runReminders(at);
  const mails = db.prepare("SELECT * FROM emails WHERE user_id = 2").all();
  assert.equal(mails.length, 1);
  assert.equal(mails[0].subject, "A free trial ends soon");
  assert.match(mails[0].body, /Max: free trial ends Sun, Nov 15\. Then \$16\.99 a month\./);
  assert.match(mails[0].body, /Gym: \$10\.00 on Mon, Nov 16 \(Visa ••4242\)\. Cancel: https:\/\/gym\.example\/cancel/);
  assert.ok(!mails[0].body.includes("Later"));
  await runReminders(at + 60_000);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM emails WHERE user_id = 2").get().n, 1);
  // Next day: the trial reminder isn't repeated; nothing new is due.
  await runReminders(Date.parse("2026-11-15T15:00:00Z"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM emails WHERE user_id = 2").get().n, 1);
  db.prepare("UPDATE users SET email_reminders = 0 WHERE id = 2").run();
  await runReminders(Date.parse("2026-11-22T15:00:00Z"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM emails WHERE user_id = 2").get().n, 1);
});

console.log(`\n${n} checks passed`);
