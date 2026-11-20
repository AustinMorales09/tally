import Link from "next/link";
import { getUser } from "@/lib/auth";
import { logout } from "@/lib/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <>
      <nav className="nav">
        <Link href={user ? "/dashboard" : "/"} className="brand">Tally</Link>
        <div className="nav-right">
          {user ? (
            <>
              <Link href="/dashboard">Overview</Link>
              <Link href="/subscriptions">Subscriptions</Link>
              <Link href="/import">Import</Link>
              <Link href="/settings">Settings</Link>
              <form action={logout}><button className="link">Log out</button></form>
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup">Sign up</Link>
            </>
          )}
        </div>
      </nav>
      {children}
    </>
  );
}
