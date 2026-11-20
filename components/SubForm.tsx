import { saveSub } from "@/lib/actions";
import { CATEGORIES, CYCLE_LABEL, CYCLES, STATUS_LABEL, type Sub, type SubStatus } from "@/lib/db";

/** Add/edit form. Server-rendered; the form's key makes it pick up saved values after a redirect. */
export default function SubForm({ sub, defaultRemind, today }: { sub?: Sub; defaultRemind: number; today: string }) {
  const s = sub;
  return (
    <form action={saveSub} key={s ? JSON.stringify(s) : "new"}>
      {s && <input type="hidden" name="sub_id" value={s.id} />}
      <div className="field"><label htmlFor="name">Name</label><input id="name" name="name" defaultValue={s?.name} required placeholder="Netflix" maxLength={80} /></div>
      <div className="grid-2">
        <div className="field"><label htmlFor="amount">Price ($)</label><input id="amount" name="amount" inputMode="decimal" defaultValue={s ? (s.amount_cents / 100).toFixed(2) : ""} required placeholder="15.49" /></div>
        <div className="field">
          <label htmlFor="cycle">Billed</label>
          <select id="cycle" name="cycle" defaultValue={s?.cycle ?? "monthly"}>{CYCLES.map((c) => <option key={c} value={c}>{CYCLE_LABEL[c]}</option>)}</select>
        </div>
        <div className="field"><label htmlFor="next_charge_on">Next charge</label><input id="next_charge_on" name="next_charge_on" type="date" defaultValue={s?.next_charge_on ?? today} required /></div>
        <div className="field">
          <label htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue={s?.category ?? "Other"}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={s?.status ?? "active"}>{(Object.keys(STATUS_LABEL) as SubStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select>
        </div>
        <div className="field"><label htmlFor="trial_ends_on">Free trial ends (if on a trial)</label><input id="trial_ends_on" name="trial_ends_on" type="date" defaultValue={s?.trial_ends_on ?? ""} /></div>
        <div className="field"><label htmlFor="remind_days">Email me this many days before it bills</label><input id="remind_days" name="remind_days" type="number" min={0} max={30} defaultValue={s?.remind_days ?? defaultRemind} /></div>
        <div className="field"><label htmlFor="payment_label">Paid with (label only)</label><input id="payment_label" name="payment_label" defaultValue={s?.payment_label} placeholder="Visa ••4242" maxLength={40} autoComplete="off" /></div>
      </div>
      <div className="field"><label htmlFor="cancel_url">Where to cancel (link)</label><input id="cancel_url" name="cancel_url" type="url" defaultValue={s?.cancel_url} placeholder="https://…/account" /></div>
      <div className="field">
        <label htmlFor="bank_text">Shows on my statement as</label>
        <input id="bank_text" name="bank_text" defaultValue={s?.merchant_key} placeholder="NETFLIX.COM" />
        <p className="small muted" style={{ margin: "4px 0 0" }}>Used to match charges from imported statements, for price changes and charges after you cancel.</p>
      </div>
      <div className="field"><label htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={2} defaultValue={s?.notes} placeholder="Shared with the family plan, renews with the annual discount…" /></div>
      <button type="submit">{s ? "Save" : "Add subscription"}</button>
    </form>
  );
}
