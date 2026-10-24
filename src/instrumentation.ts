/** Runs once when the Next.js server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.AGENT_INLINE_JOBS !== "false") {
    const { startInlineWorker } = await import("./jobs/queue");
    startInlineWorker();
    console.log("✓ Agent background worker started (checks for work every 3 seconds)");
  }
}
