import { db, tx } from "./db";
import { merchantKey } from "./merchant";
import { parseStatement, type DateFormat, type SignMode } from "./statement";
import { linkTransactions } from "./subs";

export const MAX_ROWS = 20_000;

export type ImportResult = { importId: number; rows: number; outgoing: number; added: number; duplicates: number; skipped: number; incoming: number; outIs: string; dateFormat: string } | { error: string };

/**
 * Stores a statement's outgoing transactions. Identical lines already imported (an overlapping date range)
 * are skipped; two identical charges on the same day in one file are both kept.
 */
export function importStatement(userId: number, filename: string, text: string, opts: { dateFormat?: DateFormat; sign?: SignMode } = {}): ImportResult {
  const r = parseStatement(text, opts);
  if (r.error) return { error: r.error };
  if (!r.txns.length) return { error: r.rows ? "No outgoing payments found in that file. If spending shows as positive numbers, set “Money out is” to positive." : "That file has no transactions." };
  if (r.txns.length > MAX_ROWS) return { error: `That file has more than ${MAX_ROWS.toLocaleString()} payments. Export a shorter date range (12–15 months is plenty).` };
  const seen = new Map<string, number>();
  const result = tx(() => {
    const importId = Number(db.prepare("INSERT INTO imports (user_id, filename, rows, added, first_date, last_date, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)").run(
      userId, filename.slice(0, 120), r.rows, r.txns[0].date, r.txns[r.txns.length - 1].date, Date.now(),
    ).lastInsertRowid);
    const ins = db.prepare("INSERT OR IGNORE INTO transactions (user_id, import_id, date, description, amount_cents, merchant_key, seq) VALUES (?, ?, ?, ?, ?, ?, ?)");
    let added = 0;
    for (const t of r.txns) {
      const k = `${t.date}|${t.description}|${t.amount_cents}`;
      const seq = seen.get(k) ?? 0;
      seen.set(k, seq + 1);
      added += Number(ins.run(userId, importId, t.date, t.description, t.amount_cents, merchantKey(t.description), seq).changes);
    }
    db.prepare("UPDATE imports SET added = ? WHERE id = ?").run(added, importId);
    return { importId, added };
  });
  linkTransactions(userId);
  return { ...result, rows: r.rows, outgoing: r.txns.length, duplicates: r.txns.length - result.added, skipped: r.skipped, incoming: r.incoming, outIs: r.outIs, dateFormat: r.dateFormat };
}
