import { me } from "@/lib/access";
import { db } from "@/lib/db";
import { fmtStamp } from "@/lib/time";

type Email = { id: number; recipient: string; subject: string; body: string; status: string; error: string | null; created_at: number };

export default async function Outbox() {
  const { user } = await me();
  const mails = (db.prepare("SELECT * FROM emails WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(user.id) as Email[]).map((m) => ({ ...m }));
  return (
    <main className="container narrow">
      <h1>Sent reminders</h1>
      {!process.env.RESEND_API_KEY && <p className="small muted">Email sending isn&apos;t set up on this server (RESEND_API_KEY), so reminders are kept here instead.</p>}
      {mails.length ? mails.map((m) => (
        <div className="card" key={m.id}>
          <div className="small muted">{fmtStamp(m.created_at, user.timezone)} · to {m.recipient} · {m.status}{m.error ? `: ${m.error}` : ""}</div>
          <b>{m.subject}</b>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, margin: "6px 0 0" }}>{m.body}</pre>
        </div>
      )) : <p className="muted">Nothing yet. Reminders are sent a few days before a charge or the end of a free trial.</p>}
    </main>
  );
}
