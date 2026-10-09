// Runs once when the server starts. In the test environment it calls the
// scheduled tasks every minute, the way a scheduler in the cloud will do in
// production. (The automated tests switch this off and call the tasks
// themselves, at the exact simulated time they want.)
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.APP_ENV !== "local" || process.env.DISABLE_TASK_RUNNER === "1") return;

  const globalState = globalThis as unknown as { chegoTaskTimer?: ReturnType<typeof setInterval> };
  if (globalState.chegoTaskTimer) return;

  const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/tarefas`;
  globalState.chegoTaskTimer = setInterval(() => {
    fetch(url, { method: "POST" }).catch(() => {
      // The server is restarting or the database is off: the next minute tries again.
    });
  }, 60_000);
  globalState.chegoTaskTimer.unref?.();
}
