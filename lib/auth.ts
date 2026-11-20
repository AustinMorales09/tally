import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";

const COOKIE = "sid";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export type User = { id: number; email: string };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Only a hash of the session token is stored, so a leaked DB can't be used to log in.
const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

// Hosted demo (Vercel): functions don't share a database, so the session is a signed cookie instead of a stored row.
const signedSession = process.env.VERCEL === "1";
let sessionKey: Buffer | null = null;
function sign(payload: string): string {
  sessionKey ??= process.env.SESSION_SECRET
    ? Buffer.from(process.env.SESSION_SECRET, "utf8")
    : Buffer.from(fs.readFileSync(path.join(process.cwd(), "seed", "session.key"), "utf8").trim(), "hex");
  return crypto.createHmac("sha256", sessionKey).update(payload).digest("hex");
}
function verifySigned(token: string): number | null {
  const [v, uid, exp, sig] = token.split(".");
  if (v !== "s1" || !uid || !exp || !sig || Number(exp) < Date.now()) return null;
  const want = Buffer.from(sign(`${uid}.${exp}`), "hex");
  const got = Buffer.from(sig, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want) ? Number(uid) : null;
}

export async function createSession(userId: number): Promise<void> {
  const expiresAt = Date.now() + SESSION_MS;
  const token = signedSession ? `s1.${userId}.${expiresAt}.${sign(`${userId}.${expiresAt}`)}` : crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(
    tokenHash(token),
    userId,
    expiresAt,
  );
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(tokenHash(token));
  jar.delete(COOKIE);
}

export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  if (signedSession) {
    const uid = verifySigned(token);
    return uid === null ? null : ((db.prepare("SELECT id, email FROM users WHERE id = ?").get(uid) as User | undefined) ?? null);
  }
  const row = db
    .prepare(
      `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(tokenHash(token), Date.now()) as User | undefined;
  return row ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
