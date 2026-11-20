// Bank and card statement CSVs. Every bank lays them out differently, so columns are found by name, preamble
// lines before the header are skipped, and the sign of "money out" is worked out (or chosen by the user).

export type ParsedTxn = { date: string; description: string; amount_cents: number };
export type DateFormat = "auto" | "mdy" | "dmy" | "ymd";
export type SignMode = "auto" | "negative" | "positive";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "$1,234.56" → 123456; "(12.00)" and "12.00-" are negative. Returns null when it isn't a number. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  s = s.replace(/^[A-Z]{3}\s*/i, "").replace(/[$£€\s,]/g, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return neg ? -cents : cents;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function validIso(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += 2000;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(iso + "T00:00:00Z");
  return t.getUTCMonth() + 1 === m && t.getUTCDate() === d ? iso : null;
}

/** Dates as banks write them. Numeric day/month order follows `format`; ISO and month names are unambiguous. */
export function parseDate(raw: string, format: Exclude<DateFormat, "auto">): string | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, "");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return validIso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return format === "dmy" ? validIso(+m[3], +m[2], +m[1]) : validIso(+m[3], +m[1], +m[2]);
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ ,-]*(\d{2,4})$/); // 05 Jan 2026, 05-Jan-26
  if (m && MONTHS.includes(m[2].toLowerCase())) return validIso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/); // Jan 5, 2026
  if (m && MONTHS.includes(m[1].toLowerCase())) return validIso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  return null;
}

const find = (headers: string[], patterns: RegExp[]) => {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
};

export type StatementResult = {
  txns: ParsedTxn[];          // money out only, positive cents
  rows: number;               // data rows read
  skipped: number;            // rows without a usable date or amount
  incoming: number;           // money-in rows left out
  dateFormat: Exclude<DateFormat, "auto">;
  outIs: "negative" | "positive" | "debit column";
  error?: string;
};

export function parseStatement(text: string, opts: { dateFormat?: DateFormat; sign?: SignMode } = {}): StatementResult {
  const rows = parseCsv(text);
  const empty = (error: string): StatementResult => ({ txns: [], rows: 0, skipped: 0, incoming: 0, dateFormat: "mdy", outIs: "negative", error });
  // Some banks put account details above the header; find the first row that names a date and an amount.
  const hi = rows.slice(0, 20).findIndex((r) => {
    const h = r.map((c) => c.trim().toLowerCase());
    return h.some((c) => /date/.test(c)) && h.some((c) => /amount|debit|withdrawal|paid out|money out/.test(c));
  });
  if (hi < 0) return empty("Couldn't find a header row with a date column and an amount (or debit) column.");
  const headers = rows[hi].map((c) => c.trim().toLowerCase());
  const dateCol = find(headers, [/^(transaction |trans\.? |posting |posted )?date$/, /date/]);
  const descCol = find(headers, [/^description$/, /description/, /^payee$/, /merchant/, /^name$/, /details|narrative|memo|reference/]);
  const amountCol = find(headers, [/^amount$/, /^amount \(/, /amount/]);
  const debitCol = find(headers, [/debit|withdrawal|paid out|money out/]);
  const creditCol = find(headers, [/credit|deposit|paid in|money in/]);
  if (descCol < 0) return empty("Couldn't find a description, payee or merchant column.");
  if (amountCol < 0 && debitCol < 0) return empty("Couldn't find an amount column.");

  const data = rows.slice(hi + 1).filter((r) => r.length > Math.max(dateCol, descCol));
  let fmt: Exclude<DateFormat, "auto"> = opts.dateFormat && opts.dateFormat !== "auto" ? opts.dateFormat : "mdy";
  if (!opts.dateFormat || opts.dateFormat === "auto") {
    // A first number over 12 (31/01/2026) can only be a day.
    if (data.some((r) => { const m = r[dateCol]?.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/); return !!m && +m[1] > 12; })) fmt = "dmy";
    else if (data.length && data.every((r) => /^\d{4}[-/.]/.test(r[dateCol]?.trim() ?? ""))) fmt = "ymd"; // ISO: no ambiguity, say so
  }

  type Raw = { date: string; description: string; signed: number; fromDebit: boolean };
  const raws: Raw[] = [];
  let skipped = 0;
  for (const r of data) {
    const date = parseDate(r[dateCol] ?? "", fmt);
    const description = (r[descCol] ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
    let signed: number | null = null;
    let fromDebit = false;
    if (amountCol >= 0) signed = parseAmount(r[amountCol] ?? "");
    if ((signed === null || signed === 0) && debitCol >= 0) {
      const d = parseAmount(r[debitCol] ?? "");
      const c = creditCol >= 0 ? parseAmount(r[creditCol] ?? "") : null;
      if (d) { signed = -Math.abs(d); fromDebit = true; }
      else if (c) signed = Math.abs(c);
    }
    if (!date || !description || signed === null || signed === 0) { skipped++; continue; }
    raws.push({ date, description, signed, fromDebit });
  }

  let outIs: StatementResult["outIs"] = "negative";
  if (amountCol < 0) outIs = "debit column";
  else if (opts.sign === "positive" || opts.sign === "negative") outIs = opts.sign;
  else {
    // Bank accounts usually show spending as negative; many card exports show purchases as positive.
    const amountRows = raws.filter((r) => !r.fromDebit);
    const neg = amountRows.filter((r) => r.signed < 0).length;
    outIs = neg >= amountRows.length - neg ? "negative" : "positive";
  }
  const txns: ParsedTxn[] = [];
  let incoming = 0;
  for (const r of raws) {
    const out = r.fromDebit || outIs === "debit column" ? r.signed < 0 : outIs === "negative" ? r.signed < 0 : r.signed > 0;
    if (out) txns.push({ date: r.date, description: r.description, amount_cents: Math.abs(r.signed) });
    else incoming++;
  }
  txns.sort((a, b) => a.date.localeCompare(b.date));
  return { txns, rows: data.length, skipped, incoming, dateFormat: fmt, outIs };
}
