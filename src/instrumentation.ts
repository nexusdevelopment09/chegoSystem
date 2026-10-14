// Roda uma vez quando o servidor sobe e chama as tarefas agendadas a cada minuto,
// como um agendador faria: no ambiente de testes (APP_ENV=local) e no servidor
// com Docker (INTERNAL_TASK_RUNNER=1, que manda o CRON_SECRET como qualquer
// agendador de fora). Os testes automáticos desligam isto e chamam as tarefas
// eles mesmos, no horário simulado exato que querem.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const enabled = process.env.APP_ENV === "local" || process.env.INTERNAL_TASK_RUNNER === "1";
  if (!enabled || process.env.DISABLE_TASK_RUNNER === "1") return;

  const globalState = globalThis as unknown as { chegoTaskTimer?: ReturnType<typeof setInterval> };
  if (globalState.chegoTaskTimer) return;

  const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/tarefas`;
  const headers = { "x-cron-secret": process.env.CRON_SECRET ?? "" };
  globalState.chegoTaskTimer = setInterval(() => {
    fetch(url, { method: "POST", headers }).catch(() => {
      // O servidor está reiniciando ou o banco está desligado: o próximo minuto tenta de novo.
    });
  }, 60_000);
  globalState.chegoTaskTimer.unref?.();
}
