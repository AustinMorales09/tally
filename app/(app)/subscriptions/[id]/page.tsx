import Link from "next/link";
import { ownSub } from "@/lib/access";
import { cancelSub, deleteSub, reactivateSub, updateAmount } from "@/lib/actions";
import { monthlyCents, PER, yearlyCents } from "@/lib/cycles";
import { STATUS_LABEL } from "@/lib/db";
import { linkedCharges } from "@/lib/subs";
import { fmtDate, money } from "@/lib/time";
import SubForm from "@/components/SubForm";

export default async function SubPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string; cancelled?: string; updated?: string }> }) {
  const { user, today, sub: s } = await ownSub(Number((await params).id));
  const sp = await searchParams;
  const charges = linkedCharges(s.id);
  const paid12 = charges.filter((c) => c.date > `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`).reduce((t, c) => t + c.amount_cents, 0);
  const latest = charges[0];
  const afterCancel = s.status === "cancelled" && s.cancelled_on ? charges.filter((c) => c.date > s.cancelled_on!) : [];

  return (
    <main className="container">
      <p className="small"><Link href="/subscriptions">← Subscriptions</Link></p>
      <div className="row" style={{ gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>{s.name}</h1>
        <span className={s.status === "cancelled" ? "pill-muted" : s.status === "trial" ? "pill-warn" : "pill-ok"}>{STATUS_LABEL[s.status]}</span>
      </div>
      <p className="muted">
        {money(s.amount_cents)} {PER[s.cycle]}
        {s.status === "active" && <> · next charge {fmtDate(s.next_charge_on)}</>}
        {s.status === "trial" && s.trial_ends_on && <> · free trial ends {fmtDate(s.trial_ends_on)}</>}
        {s.status === "cancelled" && s.cancelled_on && <> · cancelled {fmtDate(s.cancelled_on)}</>}
      </p>
      {sp.error && <p className="error">{sp.error}</p>}
      {sp.saved && <p className="ok-text small">Saved.</p>}
      {sp.updated && <p className="ok-text small">Price updated.</p>}
      {sp.cancelled && <p className="notice">Marked cancelled. If a charge still shows up in a later statement, the overview will flag it.</p>}
      {afterCancel.length > 0 && (
        <p className="error">Charged {afterCancel.length} time{afterCancel.length === 1 ? "" : "s"} after you cancelled ({money(afterCancel.reduce((t, c) => t + c.amount_cents, 0))}). Check the cancellation went through{s.cancel_url ? <> (<a href={s.cancel_url} target="_blank" rel="noopener noreferrer">account page</a>)</> : null} and ask for a refund.</p>
      )}
      {latest && s.status !== "cancelled" && latest.amount_cents !== s.amount_cents && (
        <form action={updateAmount} className="notice">
          Latest charge ({fmtDate(latest.date)}) was {money(latest.amount_cents)}, not {money(s.amount_cents)}.{" "}
          <input type="hidden" name="sub_id" value={s.id} />
          <input type="hidden" name="amount" value={latest.amount_cents} />
          <input type="hidden" name="back" value="sub" />
          <button type="submit" className="secondary">Update to {money(latest.amount_cents)}</button>
        </form>
      )}

      <div className="grid-2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Details</h2>
          <SubForm sub={s} defaultRemind={user.default_remind_days} today={today} />
        </div>
        <div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Cost</h2>
            <div className="kv">
              <span className="muted">Per month</span><span>{money(monthlyCents(s.amount_cents, s.cycle))}</span>
              <span className="muted">Per year</span><span>{money(yearlyCents(s.amount_cents, s.cycle))}</span>
              {charges.length > 0 && <><span className="muted">Paid, last 12 mo</span><span>{money(paid12)} <span className="muted small">(from statements)</span></span></>}
            </div>
          </div>

          {s.status !== "cancelled" ? (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Cancel it</h2>
              {s.cancel_url ? <p className="small"><a href={s.cancel_url} target="_blank" rel="noopener noreferrer">Open the account page ↗</a>, cancel there, then record it here.</p> : <p className="small muted">Cancel with the provider first, then record it here. Add a cancel link above to keep it handy.</p>}
              <form action={cancelSub} className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
                <input type="hidden" name="sub_id" value={s.id} />
                <div className="field" style={{ margin: 0 }}><label htmlFor="cancelled_on">Cancelled on</label><input id="cancelled_on" name="cancelled_on" type="date" defaultValue={today} max={today} /></div>
                <button type="submit" className="danger">I cancelled it</button>
              </form>
            </div>
          ) : (
            <form action={reactivateSub} className="card">
              <input type="hidden" name="sub_id" value={s.id} />
              <p className="small" style={{ marginTop: 0 }}>Signed up again?</p>
              <button type="submit" className="secondary">Mark active again</button>
            </form>
          )}

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Charges from your statements</h2>
            {charges.length ? (
              <table className="list">
                <tbody>
                  {charges.slice(0, 24).map((c) => (
                    <tr key={c.id}>
                      <td className="small" style={{ whiteSpace: "nowrap" }}>{fmtDate(c.date)}</td>
                      <td className="small muted" style={{ overflowWrap: "anywhere" }}>{c.description}{s.cancelled_on && c.date > s.cancelled_on ? <span className="pill-err" style={{ marginLeft: 6 }}>after cancel</span> : null}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(c.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="small muted">None matched yet. {s.merchant_key ? `Charges show up here when an imported statement has “${s.merchant_key}”.` : "Fill in “Shows on my statement as” to match imported charges."}</p>}
          </div>

          <form action={deleteSub}>
            <input type="hidden" name="sub_id" value={s.id} />
            <button type="submit" className="danger">Delete from Tally</button>
            <p className="small muted">Deleting only removes it here. It doesn&apos;t cancel anything with the provider.</p>
          </form>
        </div>
      </div>
    </main>
  );
}
