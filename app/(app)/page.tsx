import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

export default async function Home() {
  if (await getUser()) redirect("/dashboard");
  return (
    <main className="hero">
      <h1>Find every subscription you&apos;re paying for</h1>
      <p>
        Upload a CSV export from your bank or card. Tally finds the charges that repeat, shows you the evidence, and
        tracks what you confirm: what each costs per month and per year, when it renews, when a price goes up, when a
        free trial is about to bill you, and when something charges you after you cancelled it. No bank login needed.
      </p>
      <Link href="/signup" className="btn">Try it with a sample statement</Link>
    </main>
  );
}
