import { DAY_MS, fromLocal, toLocal } from "@/lib/time";

// O período escolhido no painel do admin viaja na URL (`periodo`, `dia`, `cidade`),
// para que clicar em um número abra a lista já com o mesmo recorte.

export const PERIODS = [
  { key: "hoje", label: "Hoje", text: "hoje" },
  { key: "7", label: "7 dias", text: "nos últimos 7 dias" },
  { key: "30", label: "30 dias", text: "nos últimos 30 dias" },
  { key: "90", label: "90 dias", text: "nos últimos 90 dias" },
] as const;

export type PeriodFilter = {
  /** Parâmetros para repetir este período em outro link. */
  query: Record<string, string>;
  from: Date;
  to: Date;
  /** "hoje", "nos últimos 30 dias", "em 09/10/2026". */
  text: string;
};

/** Lê `dia=AAAA-MM-DD` ou `periodo=hoje|7|30|90`. Sem nenhum dos dois, devolve null (sem recorte de datas). */
export function resolvePeriod(params: { periodo?: string; dia?: string }, at: Date): PeriodFilter | null {
  if (params.dia && /^\d{4}-\d{2}-\d{2}$/.test(params.dia) && !Number.isNaN(Date.parse(params.dia))) {
    const from = fromLocal(params.dia, 0);
    return { query: { dia: params.dia }, from, to: new Date(from.getTime() + DAY_MS), text: `em ${params.dia.split("-").reverse().join("/")}` };
  }
  const period = PERIODS.find((item) => item.key === params.periodo);
  if (!period) return null;
  const from = period.key === "hoje" ? fromLocal(toLocal(at).date, 0) : new Date(at.getTime() - Number(period.key) * DAY_MS);
  return { query: { periodo: period.key }, from, to: at, text: period.text };
}

/** Monta um endereço com os parâmetros informados, ignorando os vazios. */
export function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
