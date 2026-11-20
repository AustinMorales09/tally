import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { DEMO_EMAIL, DEMO_HOME, demoEnabled } from "@/lib/demo-login";

export const dynamic = "force-dynamic";

/** One-click demo: signs in as the seeded demo account, then goes to ?next= (same-site paths only) or the main screen. */
export async function GET(request: Request) {
  if (!demoEnabled()) redirect("/login");
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_EMAIL) as { id: number } | undefined;
  if (!user) redirect("/login");
  await createSession(user.id);
  const next = new URL(request.url).searchParams.get("next") ?? "";
  redirect(/^\/(?![\/\\])/.test(next) ? next : DEMO_HOME);
}
