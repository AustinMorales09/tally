import Link from "next/link";
import { me } from "@/lib/access";
import { deleteImport, demo, importCsv } from "@/lib/actions";
import { db } from "@/lib/db";
import { fmtDate, fmtStamp } from "@/lib/time";

type ImportRow = { id: number; filename: string; rows: number; added: number; first_date: string | null; last_date: string | null; created_at: number };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string; removed?: string }> }) {
  const { user } = await me();
  const sp = await searchParams;
  const imports = (db.prepare("SELECT * FROM imports WHERE user_id = ? ORDER BY id DESC").all(user.id) as ImportRow[]).map((r) => ({ ...r }));
  return (
    <main className="container narrow">
      <h1>Import a statement</h1>
      {sp.error && <p className="error">{sp.error}</p>}
      {sp.removed && <p className="notice">Statement removed, with its transactions.</p>}
      <div className="card">
        <p className="small" style={{ marginTop: 0 }}>
          On your bank or card website, find <b>Download</b> or <b>Export</b> on the transactions page and choose <b>CSV</b>.
          12 months or more works best, so yearly renewals show up too. Overlapping date ranges are fine; repeated lines aren&apos;t counted twice.
        </p>
        <form action={importCsv}>
          <div className="field"><label htmlFor="file">Statement (CSV)</label><input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" required /></div>
          <details style={{ marginBottom: 12 }}>
            <summary className="small">If the result looks wrong</summary>
            <div className="grid-2" style={{ marginTop: 8 }}>
              <div className="field">
                <label htmlFor="date_format">Dates are written</label>
                <select id="date_format" name="date_format" defaultValue="auto">
                  <option value="auto">Work it out</option>
                  <option value="mdy">Month first (03/31/2026)</option>
                  <option value="dmy">Day first (31/03/2026)</option>
                  <option value="ymd">Year first (2026-03-31)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="sign">Money out is</label>
                <select id="sign" name="sign" defaultValue="auto">
                  <option value="auto">Work it out</option>
                  <option value="negative">Negative (−15.49)</option>
                  <option value="positive">Positive (15.49)</option>
                </select>
              </div>
            </div>
          </details>
          <button type="submit">Import and find subscriptions</button>
        </form>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Only the date, description and amount of each payment are kept, to find repeating charges and match them later.
          Account numbers, balances and money coming in are not stored. You can remove a statement at any time.
        </p>
      </div>

      {imports.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Imported</h2>
          <table className="list">
            <tbody>
              {imports.map((i) => (
                <tr key={i.id}>
                  <td>
                    <b style={{ overflowWrap: "anywhere" }}>{i.filename}</b>
                    <div className="small muted">
                      {i.first_date && i.last_date ? `${fmtDate(i.first_date)} – ${fmtDate(i.last_date)}` : ""} · {i.added} new payment{i.added === 1 ? "" : "s"} · {fmtStamp(i.created_at, user.timezone)}
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <form action={deleteImport}>
                      <input type="hidden" name="import_id" value={i.id} />
                      <button type="submit" className="danger">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small" style={{ marginBottom: 0 }}><Link href="/review">Review repeating charges →</Link></p>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>No statement handy?</h2>
        <form action={demo}>
          <p className="small" style={{ marginTop: 0 }}>Load a made-up checking account with 13 months of spending, a cancelled service that kept charging, and a free trial about to end.</p>
          <button type="submit" className="secondary">Load the sample statement</button>
        </form>
      </div>
    </main>
  );
}
