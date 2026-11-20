import Link from "next/link";
import { signup } from "@/lib/actions";
import TimezoneSelect from "@/components/TimezoneSelect";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="container narrow">
      <div className="card">
        <h1>Create your account</h1>
        {error && <p className="error">{error}</p>}
        <form action={signup}>
          <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" type="text" required placeholder="Alex" /></div>
          <div className="field"><label htmlFor="timezone">Time zone</label><TimezoneSelect /></div>
          <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
          <div className="field"><label htmlFor="password">Password (8+ characters)</label><input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" /></div>
          <button type="submit" className="big-btn">Create account</button>
        </form>
        <p className="small muted">Already have an account? <Link href="/login">Log in</Link></p>
      </div>
    </main>
  );
}
