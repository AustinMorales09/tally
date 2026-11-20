// Next.js calls register() once at server start: keep billing dates current and send reminders.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __tick?: NodeJS.Timeout };
  if (g.__tick) return;
  const { runReminders } = await import("./lib/notify");
  let busy = false;
  g.__tick = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runReminders();
    } catch (err) {
      console.error("[reminders] failed", err);
    } finally {
      busy = false;
    }
  }, Number(process.env.TICK_MS ?? 15 * 60_000));
}
