// Public demo: the seeded account a reviewer is signed in as, and where they land.
export const DEMO_EMAIL = "alex@tally.test";
export const DEMO_HOME = "/dashboard";

/** On for the hosted demo (Vercel) or locally with DEMO_LOGIN=1. */
export function demoEnabled(): boolean {
  return process.env.VERCEL === "1" || process.env.DEMO_LOGIN === "1";
}
