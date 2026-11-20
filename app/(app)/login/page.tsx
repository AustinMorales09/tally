import { DEMO_EMAIL, demoEnabled } from "@/lib/demo-login";
import Link from "next/link";
import { login } from "@/lib/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="container narrow">
      <div className="card">
        <h1>Log in</h1>
        {error && <p className="error">{error}</p>}
        <form action={login}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          <button type="submit">Log in</button>
        </form>
        {demoEnabled() && (
          <p className="demo-login">
            <a className="btn secondary" href="/demo">Try the demo</a>{" "}
            <span className="small muted">Signs in as {DEMO_EMAIL}. Shared demo data that resets from time to time.</span>
          </p>
        )}
        <p className="small muted">
          No account? <Link href="/signup">Sign up</Link>
        </p>
      </div>
    </main>
  );
}
