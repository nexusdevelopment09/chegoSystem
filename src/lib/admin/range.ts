import { addDays } from "@/lib/fees/rules";
import { fromLocal, toLocal } from "@/lib/time";

// Períodos do super admin, no horário de Maceió (UTC-3, sem horário de verão). A semana começa
// na segunda-feira. Cada período traz o anterior equivalente, para a variação dos indicadores:
// períodos em andamento ("hoje", "esta semana"...) comparam com o mesmo trecho do anterior
// (hoje até agora × ontem até a mesma hora), para a comparação ser justa. Funções puras.

export const RANGE_PRESETS = [
  { key: "hoje", label: "Hoje" },
  { key: "ontem", label: "Ontem" },
  { key: "semana", label: "Esta semana" },
  { key: "semana_passada", label: "Semana passada" },
  { key: "mes", label: "Este mês" },
  { key: "mes_passado", label: "Mês passado" },
  { key: "ano", label: "Este ano" },
  { key: "ano_passado", label: "Ano passado" },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"] | "personalizado";

export type Range = {
  key: RangeKey;
  label: string;
  /** Início (inclusivo) e fim (exclusivo). */
  from: Date;
  to: Date;
  previous: { from: Date; to: Date; label: string };
  /** Datas locais (AAAA-MM-DD) do primeiro e do último dia. */
  firstDay: string;
  lastDay: string;
  /** Agrupar os gráficos por dia, semana ou mês, conforme o tamanho do período. */
  bucket: "hora" | "dia" | "mes";
  /** Parâmetros para repetir este período em outro link. */
  query: Record<string, string>;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string | undefined): value is string => !!value && DATE.test(value) && !Number.isNaN(Date.parse(value));

const startOfWeek = (day: string) => {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(day, -((weekday + 6) % 7));
};
const startOfMonth = (day: string) => `${day.slice(0, 8)}01`;
const shiftMonths = (day: string, months: number) => {
  const [year, month] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  return target.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const dayStart = (day: string) => fromLocal(day, 0);
const formatDay = (day: string) => day.split("-").reverse().join("/");

/** Lê `periodo` (ou `de`/`ate` para o personalizado). O padrão é "este mês". */
export function resolveRange(params: { periodo?: string; de?: string; ate?: string }, at: Date): Range {
  const today = toLocal(at).date;
  const elapsed = at.getTime() - dayStart(today).getTime(); // quanto do dia de hoje já passou

  if (validDate(params.de)) {
    const first = params.de;
    const last = validDate(params.ate) && params.ate >= first ? params.ate : first;
    const length = daysBetween(first, last) + 1;
    const prevFirst = addDays(first, -length);
    return build("personalizado", `${formatDay(first)} a ${formatDay(last)}`, first, last, dayStart(first), dayStart(addDays(last, 1)),
      { from: dayStart(prevFirst), to: dayStart(first), label: `${formatDay(prevFirst)} a ${formatDay(addDays(first, -1))}` }, { de: first, ate: last });
  }

  const key = (RANGE_PRESETS.find((preset) => preset.key === params.periodo)?.key ?? "mes") as Exclude<RangeKey, "personalizado">;
  const label = RANGE_PRESETS.find((preset) => preset.key === key)!.label;
  const query = { periodo: key };

  switch (key) {
    case "hoje": {
      const yesterday = addDays(today, -1);
      return build(key, label, today, today, dayStart(today), at,
        { from: dayStart(yesterday), to: new Date(dayStart(yesterday).getTime() + elapsed), label: "ontem até esta hora" }, query);
    }
    case "ontem": {
      const yesterday = addDays(today, -1);
      const before = addDays(today, -2);
      return build(key, label, yesterday, yesterday, dayStart(yesterday), dayStart(today), { from: dayStart(before), to: dayStart(yesterday), label: "anteontem" }, query);
    }
    case "semana": {
      const first = startOfWeek(today);
      const prevFirst = addDays(first, -7);
      const sinceStart = at.getTime() - dayStart(first).getTime();
      return build(key, label, first, today, dayStart(first), at,
        { from: dayStart(prevFirst), to: new Date(dayStart(prevFirst).getTime() + sinceStart), label: "o mesmo trecho da semana passada" }, query);
    }
    case "semana_passada": {
      const first = addDays(startOfWeek(today), -7);
      return build(key, label, first, addDays(first, 6), dayStart(first), dayStart(addDays(first, 7)),
        { from: dayStart(addDays(first, -7)), to: dayStart(first), label: "a semana anterior" }, query);
    }
    case "mes": {
      const first = startOfMonth(today);
      const prevFirst = shiftMonths(first, -1);
      const sinceStart = at.getTime() - dayStart(first).getTime();
      // Não passa do fim do mês anterior (31 de março × fevereiro).
      const prevTo = Math.min(dayStart(prevFirst).getTime() + sinceStart, dayStart(first).getTime());
      return build(key, label, first, today, dayStart(first), at, { from: dayStart(prevFirst), to: new Date(prevTo), label: "o mesmo trecho do mês passado" }, query);
    }
    case "mes_passado": {
      const first = shiftMonths(startOfMonth(today), -1);
      const next = startOfMonth(today);
      return build(key, label, first, addDays(next, -1), dayStart(first), dayStart(next),
        { from: dayStart(shiftMonths(first, -1)), to: dayStart(first), label: "o mês anterior" }, query);
    }
    case "ano": {
      const first = `${today.slice(0, 4)}-01-01`;
      const prevFirst = `${Number(today.slice(0, 4)) - 1}-01-01`;
      const sinceStart = at.getTime() - dayStart(first).getTime();
      return build(key, label, first, today, dayStart(first), at,
        { from: dayStart(prevFirst), to: new Date(Math.min(dayStart(prevFirst).getTime() + sinceStart, dayStart(first).getTime())), label: "o mesmo trecho do ano passado" }, query);
    }
    case "ano_passado": {
      const year = Number(today.slice(0, 4)) - 1;
      const first = `${year}-01-01`;
      return build(key, label, first, `${year}-12-31`, dayStart(first), dayStart(`${year + 1}-01-01`),
        { from: dayStart(`${year - 1}-01-01`), to: dayStart(first), label: "o ano anterior" }, query);
    }
  }
}

function build(key: RangeKey, label: string, firstDay: string, lastDay: string, from: Date, to: Date, previous: Range["previous"], query: Record<string, string>): Range {
  const days = daysBetween(firstDay, lastDay) + 1;
  return { key, label, from, to, previous, firstDay, lastDay, query, bucket: days <= 1 ? "hora" : days <= 62 ? "dia" : "mes" };
}

export type Variation = { pct: number | null; direction: "up" | "down" | "same" | "new" | "none" };

/** Variação percentual contra o período anterior; sem base anterior, diz isso em vez de inventar. */
export function variation(current: number, previous: number): Variation {
  if (current === 0 && previous === 0) return { pct: null, direction: "none" };
  if (previous === 0) return { pct: null, direction: "new" };
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  return { pct: Math.abs(pct), direction: pct > 0 ? "up" : pct < 0 ? "down" : "same" };
}

/** Rótulo de cada ponto do gráfico conforme o agrupamento. */
export function bucketLabel(bucket: Range["bucket"], value: string): string {
  if (bucket === "hora") return `${Number(value)}h`;
  if (bucket === "mes") return ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(value.slice(5, 7)) - 1] + `/${value.slice(2, 4)}`;
  return value.slice(8, 10) + "/" + value.slice(5, 7);
}
