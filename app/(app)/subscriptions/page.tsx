import Link from "next/link";
import { me } from "@/lib/access";
import { monthlyCents, PER } from "@/lib/cycles";
import { STATUS_LABEL, type SubStatus } from "@/lib/db";
import { userSubs } from "@/lib/subs";
import { fmtDate, money } from "@/lib/time";

const TABS = [["current", "Active & trials"], ["paused", "Paused"], ["cancelled", "Cancelled"], ["all", "All"]] as const;

export default async function Subscriptions({ searchParams }: { searchParams: Promise<{ tab?: string; deleted?: string }> }) {
  const { user } = await me();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "current";
  const all = userSubs(user.id);
  const shown = all
    .filter((s) => (tab === "all" ? true : tab === "current" ? s.status === "active" || s.status === "trial" : s.status === (tab as SubStatus)))
    .sort((a, b) => monthlyCents(b.amount_cents, b.cycle) - monthlyCents(a.amount_cents, a.cycle));
  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0 }}>Subscriptions</h1>
        <div className="row" style={{ gap: 8 }}>
          <a href="/export" className="btn secondary">Export CSV</a>
          <Link href="/subscriptions/new" className="btn">Add</Link>
        </div>
      </div>
      {sp.deleted && <p className="notice">Deleted.</p>}
      <div className="filters" style={{ marginTop: 12 }}>
        {TABS.map(([k, label]) => <Link key={k} href={`/subscriptions?tab=${k}`} className={tab === k ? "on" : ""}>{label}</Link>)}
      </div>
      <div className="table-wrap">
        <table className="list">
          <thead><tr><th>Name</th><th>Price</th><th className="hide-sm">Per month</th><th>Next</th><th className="hide-sm">Status</th></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td><Link href={`/subscriptions/${s.id}`}><b>{s.name}</b></Link><div className="small muted">{s.category}</div></td>
                <td style={{ whiteSpace: "nowrap" }}>{money(s.amount_cents)}<div className="small muted">{PER[s.cycle]}</div></td>
                <td className="hide-sm">{s.status === "active" || s.status === "trial" ? money(monthlyCents(s.amount_cents, s.cycle)) : <span className="muted">–</span>}</td>
                <td className="small" style={{ whiteSpace: "nowrap" }}>
                  {s.status === "active" ? fmtDate(s.next_charge_on) : s.status === "trial" && s.trial_ends_on ? <>trial ends<br />{fmtDate(s.trial_ends_on)}</> : <span className="muted">–</span>}
                </td>
                <td className="small hide-sm">{STATUS_LABEL[s.status]}{s.status === "cancelled" && s.cancelled_on ? <div className="muted">{fmtDate(s.cancelled_on)}</div> : null}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={5} className="muted">Nothing here. <Link href="/subscriptions/new">Add a subscription</Link> or <Link href="/import">import a statement</Link>.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
