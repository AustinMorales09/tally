import Link from "next/link";
import { me } from "@/lib/access";
import { confirmCandidate, ignoreCandidate, unignoreAll } from "@/lib/actions";
import { PER } from "@/lib/cycles";
import { CATEGORIES, CYCLE_LABEL, db } from "@/lib/db";
import { displayName, guessCategory } from "@/lib/merchant";
import { untrackedCandidates } from "@/lib/subs";
import { fmtDate, money } from "@/lib/time";

type SP = { import?: string; added?: string; dup?: string; skipped?: string; in?: string; out?: string; fmt?: string; demo?: string; added_name?: string; ignored?: string };
const FMT = { mdy: "month first", dmy: "day first", ymd: "year first" } as Record<string, string>;

export default async function Review({ searchParams }: { searchParams: Promise<SP> }) {
  const { user } = await me();
  const sp = await searchParams;
  const candidates = untrackedCandidates(user.id);
  const ignoredCount = (db.prepare("SELECT COUNT(*) AS n FROM ignored_merchants WHERE user_id = ?").get(user.id) as { n: number }).n;
  const txnCount = (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?").get(user.id) as { n: number }).n;

  return (
    <main className="container">
      <h1>Repeating charges</h1>
      {sp.import && (
        <p className="notice">
          Imported {sp.added} new payment{sp.added === "1" ? "" : "s"}
          {Number(sp.dup) ? `; ${sp.dup} already imported` : ""}
          {Number(sp.skipped) ? `; ${sp.skipped} line${sp.skipped === "1" ? "" : "s"} without a date or amount skipped` : ""}.{" "}
          <span className="muted">Read dates as {FMT[sp.fmt ?? ""] ?? sp.fmt}, money out as {sp.out}{Number(sp.in) ? `, and left out ${sp.in} incoming` : ""}. Wrong? Re-import with the options under “If the result looks wrong”.</span>
        </p>
      )}
      {sp.demo && <p className="notice">Sample statement loaded. Confirm the charges that are subscriptions; ignore the rest (rent is recurring but probably not something to track here).</p>}
      {sp.added_name && <p className="ok-text">Added {sp.added_name}. <Link href="/dashboard">See the overview</Link></p>}

      {!txnCount ? (
        <div className="card"><p style={{ margin: 0 }}>No statements yet. <Link href="/import">Import one</Link> to find repeating charges.</p></div>
      ) : !candidates.length ? (
        <div className="card"><p style={{ margin: 0 }}>Nothing new to review: every repeating charge found is tracked{ignoredCount ? " or ignored" : ""}. <Link href="/dashboard">Back to the overview</Link></p></div>
      ) : (
        <p className="small muted">
          Found by looking for charges from the same merchant at a regular interval and a steady price, still happening recently.
          Check each one: confirm it to track it, or ignore it.
        </p>
      )}

      {candidates.map((c) => (
        <div className="card" key={c.id}>
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <b>{displayName(c.merchant_key)}</b> <span className="muted small">“{c.charges[c.charges.length - 1].description}”</span>
              <div>{money(c.amount_cents)} {PER[c.cycle]} · {c.charges.length} charges since {fmtDate(c.charges[0].date)} · next expected {fmtDate(c.next_expected)}</div>
              {c.price_change && <div className="small"><span className={c.price_change.to > c.price_change.from ? "pill-warn" : "pill-ok"}>Price {c.price_change.to > c.price_change.from ? "went up" : "went down"}</span> {money(c.price_change.from)} → {money(c.price_change.to)} on {fmtDate(c.price_change.on)}</div>}
              {c.amount_split !== null && <div className="small muted">This merchant bills more than one amount; this is the {money(c.amount_split)} series.</div>}
            </div>
            <span className={c.confidence === "high" ? "pill-ok" : "pill-muted"} title={c.confidence === "high" ? "Same amount at the same interval every time" : "Regular, with a price change or an irregular gap"}>{c.confidence === "high" ? "Very regular" : "Mostly regular"}</span>
          </div>
          <details style={{ margin: "8px 0" }}>
            <summary className="small">Charges it&apos;s based on</summary>
            <table className="list" style={{ marginTop: 6 }}>
              <tbody>
                {[...c.charges].reverse().slice(0, 15).map((t, i) => (
                  <tr key={i}><td className="small">{fmtDate(t.date)}</td><td className="small muted" style={{ overflowWrap: "anywhere" }}>{t.description}</td><td className="small" style={{ textAlign: "right" }}>{money(t.amount_cents)}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
          <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <form action={confirmCandidate} className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
              <input type="hidden" name="candidate" value={c.id} />
              <div className="field" style={{ margin: 0 }}><label htmlFor={`n-${c.id}`}>Name</label><input id={`n-${c.id}`} name="name" defaultValue={displayName(c.merchant_key)} maxLength={80} /></div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor={`c-${c.id}`}>Category</label>
                <select id={`c-${c.id}`} name="category" defaultValue={guessCategory(c.merchant_key)}>{CATEGORIES.map((x) => <option key={x}>{x}</option>)}</select>
              </div>
              <button type="submit">Track it ({CYCLE_LABEL[c.cycle].toLowerCase()})</button>
            </form>
            <form action={ignoreCandidate}>
              <input type="hidden" name="candidate" value={c.id} />
              <button type="submit" className="secondary">Not a subscription</button>
            </form>
          </div>
        </div>
      ))}

      {ignoredCount > 0 && (
        <form action={unignoreAll} className="small muted">
          {ignoredCount} ignored. <button type="submit" className="link">Show them again</button>
        </form>
      )}
    </main>
  );
}
