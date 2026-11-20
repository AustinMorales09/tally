import { addDaysIso } from "./cycles";
import { db } from "./db";
import { importStatement } from "./importer";

// A made-up checking account: 13 months of subscriptions mixed with everyday spending, in a common bank
// export layout (MM/DD/YYYY, spending negative). Deterministic, so the sample looks the same every time.

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const pad = (n: number) => String(n).padStart(2, "0");
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const ym = (y: number, m: number, d: number) => {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(d, last))}`;
};

export function demoStatement(today: string): string {
  const rand = rng(42);
  const start = addDaysIso(today, -395);
  const rows: [string, string, number][] = [];
  const monthly = (desc: string, day: number, amount: (i: number, iso: string) => number, until = today, from = start) => {
    const [y0, m0] = from.split("-").map(Number);
    for (let i = 0; i < 14; i++) {
      const total = y0 * 12 + (m0 - 1) + i;
      const iso = ym(Math.floor(total / 12), (total % 12) + 1, day);
      if (iso >= from && iso <= until && iso <= today) rows.push([iso, desc.replace("{n}", String(Math.floor(rand() * 9000 + 1000))), -amount(i, iso)]);
    }
  };
  const priceRise = addDaysIso(today, -80);
  monthly("NETFLIX.COM 866-579-7172 CA", 5, (_, iso) => (iso >= priceRise ? 1799 : 1549));
  monthly("Spotify USA 877-778-1161", 12, () => 1199);
  monthly("APPLE.COM/BILL 866-712-7753 CA", 20, () => 299);
  monthly("APPLE.COM/BILL 866-712-7753 CA", 3, () => 1099);
  monthly("PLANET FITNESS #{n} AUSTIN TX", 17, () => 2499);
  monthly("PAYPAL *ADOBE 4029357733", 8, () => 2299);
  monthly("HULU 877-8244858 CA", 26, () => 1899, addDaysIso(today, -15));
  monthly("ZELLE TO MORGAN PROPERTIES", 1, () => 185000);
  monthly("CITY OF AUSTIN UTILITIES", 22, () => Math.round(9000 + rand() * 9000));
  monthly("CHASE CREDIT CRD AUTOPAY", 15, () => Math.round(40000 + rand() * 90000));
  // A yearly domain renewal and a stopped meal-kit habit.
  rows.push([addDaysIso(today, -372), "NAMECHEAP.COM*{n} PHOENIX AZ".replace("{n}", "8RT2"), -1598]);
  rows.push([addDaysIso(today, -7), "NAMECHEAP.COM*{n} PHOENIX AZ".replace("{n}", "Q71C"), -1798]);
  for (let d = addDaysIso(start, 3); d < addDaysIso(start, 120); d = addDaysIso(d, 7)) rows.push([d, "HELLOFRESH 646-846-3663 NY", -6999]);
  // Everyday spending.
  for (let d = start; d <= today; d = addDaysIso(d, 1)) {
    const r = rand();
    if (r < 0.18) rows.push([d, `WHOLEFDS MKT #${10200 + Math.floor(rand() * 40)} AUSTIN TX`, -Math.round(2000 + rand() * 14000)]);
    else if (r < 0.3) rows.push([d, `SQ *BLUE BOTTLE COFFEE`, -Math.round(450 + rand() * 900)]);
    else if (r < 0.38) rows.push([d, `AMZN Mktp US*${Math.floor(rand() * 1e6).toString(36).toUpperCase()}`, -Math.round(900 + rand() * 6000)]);
    else if (r < 0.43) rows.push([d, `SHELL OIL ${57000 + Math.floor(rand() * 900)}`, -Math.round(3000 + rand() * 3000)]);
    if (d.endsWith("-01") || d.endsWith("-15")) rows.push([d, "ACME CORP PAYROLL", 312500]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const lines = ["Details,Posting Date,Description,Amount,Type,Balance"];
  let bal = 820000;
  for (const [iso, desc, cents] of rows) {
    bal += cents;
    lines.push([cents < 0 ? "DEBIT" : "CREDIT", usDate(iso), `"${desc}"`, (cents / 100).toFixed(2), cents < 0 ? "DEBIT_CARD" : "ACH_CREDIT", (bal / 100).toFixed(2)].join(","));
  }
  return lines.join("\n") + "\n";
}

/** Imports the sample statement and adds two hand-entered subscriptions: one cancelled, one free trial. */
export function loadDemo(userId: number, today: string) {
  const r = importStatement(userId, "sample-checking.csv", demoStatement(today));
  if ("error" in r) throw new Error(r.error);
  const ins = db.prepare(
    `INSERT INTO subscriptions (user_id, name, amount_cents, cycle, next_charge_on, anchor_day, category, status, trial_ends_on, cancelled_on, cancel_url, merchant_key, remind_days, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run(userId, "Hulu", 1899, "monthly", addDaysIso(today, 11), 26, "Streaming", "cancelled", null, addDaysIso(today, -50), "https://secure.hulu.com/account", "HULU", 3, "Cancelled in the app.", Date.now());
  const trialEnd = addDaysIso(today, 2);
  ins.run(userId, "Peacock Premium", 799, "monthly", trialEnd, Number(trialEnd.slice(8)), "Streaming", "trial", trialEnd, null, "https://www.peacocktv.com/account", "", 3, "", Date.now());
  // Re-link now that the cancelled Hulu subscription exists.
  return importStatementLink(userId, r);
}

function importStatementLink(userId: number, r: { importId: number }) {
  void import("./subs").then(({ linkTransactions }) => linkTransactions(userId));
  return r.importId;
}
