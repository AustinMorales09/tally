import { db } from "./db";

// Email goes through Resend (RESEND_API_KEY + EMAIL_FROM). Without it, messages are kept in the in-app outbox.

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3024").replace(/\/$/, "");
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

export async function sendEmail(o: { userId: number; to: string; subject: string; body: string }) {
  const record = (status: string, error: string | null = null) =>
    db.prepare("INSERT INTO emails (user_id, recipient, subject, body, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(o.userId, o.to, o.subject, o.body, status, error, Date.now());
  if (!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)) return record("outbox");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [o.to], subject: o.subject, text: o.body }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    record("sent");
  } catch (err) {
    record("failed", err instanceof Error ? err.message : String(err));
  }
}
