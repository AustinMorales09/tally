import { notFound } from "next/navigation";
import { requireUser } from "./auth";
import { db, type Sub, type User } from "./db";
import { rollSubs } from "./subs";
import { today } from "./time";

/** The signed-in user, with billing dates brought up to date for today. */
export async function me(): Promise<{ user: User; today: string }> {
  const u = await requireUser();
  const user = { ...(db.prepare("SELECT * FROM users WHERE id = ?").get(u.id) as User) };
  const t = today(user.timezone);
  rollSubs(user.id, t);
  return { user, today: t };
}

export async function ownSub(id: number) {
  const ctx = await me();
  const s = db.prepare("SELECT * FROM subscriptions WHERE id = ? AND user_id = ?").get(id, ctx.user.id) as Sub | undefined;
  if (!s) notFound();
  return { ...ctx, sub: { ...s } as Sub };
}
