import Link from "next/link";
import { me } from "@/lib/access";
import { dismissAlert, updateAmount } from "@/lib/actions";
import { computeAlerts } from "@/lib/alerts";
import { addDaysIso, chargesBetween, monthlyCents, PER, yearlyCents } from "@/lib/cycles";
import { db } from "@/lib/db";
import { untrackedCandidates, userSubs } from "@/lib/subs";
import { fmtDay, money } from "@/lib/time";

const ALERT_PILL = { after_cancel: "pill-err", price: "pill-warn", trial: "pill-warn", annual: "pill-due", duplicate: "pill-muted" } as const;
const ALERT_LABEL = { after_cancel: "Charged after cancel", price: "Price change", trial: "Trial ending", annual: "Yearly renewal", duplicate: "Duplicate?" } as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { user, today } = await me();
  const sp = await searchParams;
  const subs = userSubs(user.id);
  const active = subs.filter((s) => s.status === "active");
  const trials = subs.filter((s) => s.status === "trial");
  const monthly = active.reduce((t, s) => t + monthlyCents(s.amount_cents, s.cycle), 0);
  const yearly = active.reduce((t, s) => t + yearlyCents(s.amount_cents, s.cycle), 0);
  const alerts = computeAlerts(user.id, today, subs);
  const candidates = untrackedCandidates(user.id);
  const hasImports = !!db.prepare("SELECT 1 FROM imports WHERE user_id = ? LIMIT 1").get(user.id);

  const horizon = addDaysIso(today, 30);
  const upcoming = [
    ...active.flatMap((s) => chargesBetween(s.next_charge_on, s.cycle, s.anchor_day, today, horizon).map((d) => ({ date: d, s, trial: false }))),
    ...trials.filter((s) => s.trial_ends_on && s.trial_ends_on <= horizon).map((s) => ({ date: s.trial_ends_on!, s, trial: true })),
  ].sort((a, b) => a.date.localeCompare(b.date) || b.s.amount_cents - a.s.amount_cents);
  const upcomingTotal = upcoming.reduce((t, u) => t + u.s.amount_cents, 0);

  const byCat = new Map<string, number>();
  active.forEach((s) => byCat.set(s.category, (byCat.get(s.category) ?? 0) + monthlyCents(s.amount_cents, s.cycle)));
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const top = cats[0]?.[1] ?? 1;

  if (!subs.length && !hasImports) {
    return (
      <main className="container narrow">
        <h1>Welcome{user.name ? `, ${user.name}` : ""}</h1>
        {sp.welcome && <p className="notice">Two ways to start: upload a bank or card statement and let Tally find the repeating charges, or add subscriptions by hand.</p>}
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Find them in a statement</h2>
          <p className="small">Export 12 months of transactions as CSV from your bank or card website. Nothing connects to your bank.</p>
          <Link href="/import" className="btn">Upload a statement</Link>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Or add one yourself</h2>
          <Link href="/subscriptions/new" className="btn secondary">Add a subscription</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>Overview</h1>
      <div className="grid-2" style={{ marginBottom: 12 }}>
        <div className="card" style={{ margin: 0 }}>
          <div className="small muted">You pay about</div>
          <div style={{ fontSize: 32, fontWeight: 800 }}>{money(monthly)}<span className="muted" style={{ fontSize: 16, fontWeight: 400 }}> / month</span></div>
          <div className="small muted">{money(yearly)} a year across {active.length} active subscription{active.length === 1 ? "" : "s"}{trials.length ? `, plus ${trials.length} free trial${trials.length === 1 ? "" : "s"}` : ""}.</div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="small muted">Next 30 days</div>
          <div style={{ fontSize: 32, fontWeight: 800 }}>{money(upcomingTotal)}</div>
          <div className="small muted">{upcoming.length} charge{upcoming.length === 1 ? "" : "s"} expected{upcoming.some((u) => u.trial) ? ", including trials that start billing" : ""}.</div>
        </div>
      </div>

      {candidates.length > 0 && (
        <p className="notice">
          {candidates.length} repeating charge{candidates.length === 1 ? "" : "s"} in your statements {candidates.length === 1 ? "isn't" : "aren't"} tracked yet.{" "}
          <Link href="/review">Review them</Link>
        </p>
      )}

      {alerts.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Needs a look</h2>
          {alerts.map((a) => (
            <div key={a.key} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
              <div className="row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className={ALERT_PILL[a.kind]}>{ALERT_LABEL[a.kind]}</span>
                <Link href={`/subscriptions/${a.subId}`}><b>{a.title}</b></Link>
              </div>
              <div className="small" style={{ margin: "4px 0 6px" }}>{a.detail}</div>
              <div className="row" style={{ gap: 8 }}>
                {a.newAmount !== undefined && (
                  <form action={updateAmount}>
                    <input type="hidden" name="sub_id" value={a.subId} />
                    <input type="hidden" name="amount" value={a.newAmount} />
                    <button type="submit">Update to {money(a.newAmount)}</button>
                  </form>
                )}
                <form action={dismissAlert}>
                  <input type="hidden" name="key" value={a.key} />
                  <button type="submit" className="secondary">Dismiss</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Coming up</h2>
          {upcoming.length ? (
            <table className="list">
              <tbody>
                {upcoming.slice(0, 25).map((u, i) => (
                  <tr key={i}>
                    <td className="small" style={{ whiteSpace: "nowrap" }}>{u.date === today ? "Today" : fmtDay(u.date)}</td>
                    <td><Link href={`/subscriptions/${u.s.id}`}>{u.s.name}</Link>{u.trial && <div className="small muted">free trial ends, then billing starts</div>}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(u.s.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="small muted">Nothing in the next 30 days.</p>}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Per month, by category</h2>
          {cats.length ? cats.map(([cat, cents]) => (
            <div key={cat} style={{ marginBottom: 8 }}>
              <div className="row small" style={{ justifyContent: "space-between" }}><span>{cat}</span><span>{money(cents)}</span></div>
              <div style={{ height: 8, borderRadius: 4, background: "var(--code-bg)" }}>
                <div style={{ width: `${Math.max(3, (cents / top) * 100)}%`, height: 8, borderRadius: 4, background: "var(--accent)" }} />
              </div>
            </div>
          )) : <p className="small muted">No active subscriptions yet.</p>}
          {active.length > 0 && (
            <p className="small muted" style={{ marginBottom: 0 }}>
              Biggest: {[...active].sort((a, b) => yearlyCents(b.amount_cents, b.cycle) - yearlyCents(a.amount_cents, a.cycle)).slice(0, 3).map((s) => `${s.name} (${money(s.amount_cents)} ${PER[s.cycle]})`).join(", ")}.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
