import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { monthlyCents, yearlyCents } from "@/lib/cycles";
import { CYCLE_LABEL, STATUS_LABEL } from "@/lib/db";
import { userSubs } from "@/lib/subs";

const cell = (v: string | number | null | undefined) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // keep spreadsheets from running it as a formula
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dollars = (c: number) => (c / 100).toFixed(2);

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const lines = [["Name", "Category", "Price", "Billed", "Per month", "Per year", "Status", "Next charge", "Trial ends", "Cancelled on", "Paid with", "Cancel link", "Notes"].join(",")];
  for (const s of userSubs(user.id)) {
    lines.push([s.name, s.category, dollars(s.amount_cents), CYCLE_LABEL[s.cycle], dollars(monthlyCents(s.amount_cents, s.cycle)), dollars(yearlyCents(s.amount_cents, s.cycle)), STATUS_LABEL[s.status], s.status === "active" ? s.next_charge_on : "", s.trial_ends_on, s.cancelled_on, s.payment_label, s.cancel_url, s.notes].map(cell).join(","));
  }
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="subscriptions.csv"', "Cache-Control": "no-store" },
  });
}
