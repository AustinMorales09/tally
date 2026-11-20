import Link from "next/link";
import { me } from "@/lib/access";
import SubForm from "@/components/SubForm";

export default async function NewSub({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { user, today } = await me();
  const { error } = await searchParams;
  return (
    <main className="container narrow">
      <p className="small"><Link href="/subscriptions">← Subscriptions</Link></p>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Add a subscription</h1>
        {error && <p className="error">{error}</p>}
        <SubForm defaultRemind={user.default_remind_days} today={today} />
      </div>
    </main>
  );
}
