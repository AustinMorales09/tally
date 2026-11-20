import Link from "next/link";
import { me } from "@/lib/access";
import { saveSettings } from "@/lib/actions";
import TimezoneSelect from "@/components/TimezoneSelect";

export default async function Settings({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { user } = await me();
  const sp = await searchParams;
  return (
    <main className="container narrow">
      <div className="card">
        <h1>Settings</h1>
        {sp.error && <p className="error">{sp.error}</p>}
        {sp.saved && <p className="ok-text small">Saved.</p>}
        <form action={saveSettings} key={`${user.name}${user.timezone}${user.email_reminders}${user.default_remind_days}`}>
          <div className="field"><label htmlFor="name">Name</label><input id="name" name="name" defaultValue={user.name} maxLength={60} /></div>
          <div className="field"><label htmlFor="timezone">Time zone (for &quot;today&quot; and reminder timing)</label><TimezoneSelect value={user.timezone} /></div>
          <label className="choice-row"><input type="checkbox" name="email_reminders" defaultChecked={!!user.email_reminders} /> Email me before charges and before free trials end</label>
          <div className="field"><label htmlFor="default_remind_days">For new subscriptions, remind me this many days before (0 = off)</label><input id="default_remind_days" name="default_remind_days" type="number" min={0} max={30} defaultValue={user.default_remind_days} /></div>
          <button type="submit">Save</button>
        </form>
        <p className="small muted">Reminders go to {user.email}. <Link href="/outbox">See what was sent</Link>.</p>
      </div>
    </main>
  );
}
