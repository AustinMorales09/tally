import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const dataDir = process.env.DATA_DIR ?? (process.env.VERCEL ? demoDataDir() : path.join(process.env.APP_DIR ?? process.cwd(), "data"));

// Vercel deployments are read-only: copy the bundled demo snapshot (seed/) to /tmp once per instance and work there.
// Changes last as long as the instance does, so the public demo resets itself.
function demoDataDir(): string {
  const dir = "/tmp/data";
  const seed = path.join(process.cwd(), "seed");
  if (!fs.existsSync(path.join(dir, "app.db")) && fs.existsSync(seed)) fs.cpSync(seed, dir, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function init(): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "app.db"));
  db.exec(`
    PRAGMA busy_timeout = 5000; -- first, so parallel build workers wait instead of failing
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      email_reminders INTEGER NOT NULL DEFAULT 1,
      default_remind_days INTEGER NOT NULL DEFAULT 3,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);

    -- AUTOINCREMENT: transactions and reminder keys refer to subscription ids, which must never be reused.
    -- cycle: weekly | biweekly | monthly | quarterly | yearly.  anchor_day: the day of month it bills on (1-31),
    -- kept so a 31st subscription returns to the 31st after a short month.  status: active | trial | paused | cancelled.
    -- merchant_key: the normalized bank description its charges show up under (see lib/merchant.ts).
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      cycle TEXT NOT NULL,
      next_charge_on TEXT NOT NULL,
      anchor_day INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other',
      status TEXT NOT NULL DEFAULT 'active',
      trial_ends_on TEXT,
      cancelled_on TEXT,
      cancel_url TEXT NOT NULL DEFAULT '',
      payment_label TEXT NOT NULL DEFAULT '',
      merchant_key TEXT NOT NULL DEFAULT '',
      remind_days INTEGER NOT NULL DEFAULT 3,
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS subs_user ON subscriptions(user_id);

    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      rows INTEGER NOT NULL,
      added INTEGER NOT NULL,
      first_date TEXT,
      last_date TEXT,
      created_at INTEGER NOT NULL
    );

    -- Only what detection needs: date, description, amount (positive = money out). No account numbers or balances.
    -- seq tells apart identical charges on the same day, so re-importing an overlapping statement doesn't double them.
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      merchant_key TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      sub_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
      UNIQUE (user_id, date, description, amount_cents, seq)
    );
    CREATE INDEX IF NOT EXISTS txn_key ON transactions(user_id, merchant_key);
    CREATE INDEX IF NOT EXISTS txn_sub ON transactions(sub_id);

    -- Detected merchants the user said aren't subscriptions.
    CREATE TABLE IF NOT EXISTS ignored_merchants (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, merchant_key TEXT NOT NULL, PRIMARY KEY (user_id, merchant_key));
    -- Alerts the user dismissed (by alert key).
    CREATE TABLE IF NOT EXISTS dismissed (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, alert_key TEXT NOT NULL, PRIMARY KEY (user_id, alert_key));
    -- One row per reminder sent, so each is sent once.
    CREATE TABLE IF NOT EXISTS reminder_log (user_id INTEGER NOT NULL, reminder_key TEXT NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (user_id, reminder_key));

    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

const g = globalThis as unknown as { __db?: DatabaseSync };
export const db = g.__db ?? (g.__db = init());

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export type Cycle = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
export const CYCLES: Cycle[] = ["weekly", "biweekly", "monthly", "quarterly", "yearly"];
export const CYCLE_LABEL: Record<Cycle, string> = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly" };
export type SubStatus = "active" | "trial" | "paused" | "cancelled";
export const STATUS_LABEL: Record<SubStatus, string> = { active: "Active", trial: "Free trial", paused: "Paused", cancelled: "Cancelled" };
export const CATEGORIES = ["Streaming", "Music", "Software", "Cloud & storage", "News & reading", "Fitness", "Gaming", "Phone & internet", "Food", "Shopping", "Utilities", "Insurance", "Other"];

export type User = { id: number; email: string; name: string; timezone: string; email_reminders: number; default_remind_days: number; created_at: number };
export type Sub = {
  id: number; user_id: number; name: string; amount_cents: number; cycle: Cycle; next_charge_on: string; anchor_day: number; category: string;
  status: SubStatus; trial_ends_on: string | null; cancelled_on: string | null; cancel_url: string; payment_label: string; merchant_key: string;
  remind_days: number; notes: string; created_at: number;
};
export type Txn = { id: number; user_id: number; import_id: number; date: string; description: string; amount_cents: number; merchant_key: string; seq: number; sub_id: number | null };
