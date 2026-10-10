// Roda uma vez quando o servidor sobe. No ambiente de testes ele chama as
// tarefas agendadas a cada minuto, como um agendador na nuvem vai fazer em
// produção. (Os testes automáticos desligam isto e chamam as tarefas
// eles mesmos, no horário simulado exato que querem.)
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.APP_ENV !== "local" || process.env.DISABLE_TASK_RUNNER === "1") return;

  const globalState = globalThis as unknown as { chegoTaskTimer?: ReturnType<typeof setInterval> };
  if (globalState.chegoTaskTimer) return;

  const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/tarefas`;
  globalState.chegoTaskTimer = setInterval(() => {
    fetch(url, { method: "POST" }).catch(() => {
      // O servidor está reiniciando ou o banco está desligado: o próximo minuto tenta de novo.
    });
  }, 60_000);
  globalState.chegoTaskTimer.unref?.();
}
