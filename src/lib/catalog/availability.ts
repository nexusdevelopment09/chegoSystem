// Este produto pode ser pedido agora (ou para um horário agendado)? Funções puras.
import { formatHour, fromLocal, MINUTE_MS, parseTime, toLocal, WEEKDAY_NAMES } from "../time.ts";

export type AvailabilityWindow = { weekday: number; startsAt: string; endsAt: string };

export type ProductRules = {
  available: boolean;
  trackStock: boolean;
  stockQty: number | null;
  /** Sob encomenda: minutos de antecedência de que a loja precisa. */
  minLeadMinutes: number;
  /** Sem faixas = todos os dias, o dia inteiro. */
  windows: AvailabilityWindow[];
};

export type ProductStatus =
  | { orderable: true; mustSchedule: boolean; note: string | null }
  | { orderable: false; reason: "sold_out" | "outside_window"; note: string };

/** Verdadeiro quando o produto é oferecido naquele momento (dia e faixa de horário). */
export function inWindow(windows: AvailabilityWindow[], at: Date): boolean {
  if (windows.length === 0) return true;
  const local = toLocal(at);
  return windows.some(
    (window) =>
      window.weekday === local.weekday &&
      local.minutes >= parseTime(window.startsAt) &&
      local.minutes <= parseTime(window.endsAt),
  );
}

/** "Só até 10h", "Só na segunda", "Só de segunda a sábado até 10h"... */
function windowNote(windows: AvailabilityWindow[]): string {
  const days = [...new Set(windows.map((window) => window.weekday))].sort();
  const first = windows[0];
  const start = parseTime(first.startsAt);
  const end = parseTime(first.endsAt);
  const allDay = start === 0 && end >= 23 * 60 + 59;
  const hours = allDay ? "" : start === 0 ? `até ${formatHour(end)}` : `das ${formatHour(start)} às ${formatHour(end)}`;
  const dayText = days.length === 7 ? "" : days.length === 1 ? `${WEEKDAY_NAMES[days[0]] === "sábado" || WEEKDAY_NAMES[days[0]] === "domingo" ? "no" : "na"} ${WEEKDAY_NAMES[days[0]]}` : `em ${days.map((day) => WEEKDAY_NAMES[day]).join(", ")}`;
  return `Só ${[dayText, hours].filter(Boolean).join(" ")}`.trim();
}

/**
 * `when` é o momento em que o pedido seria preparado: agora, para um pedido
 * imediato, ou o horário agendado.
 */
export function productStatus(rules: ProductRules, when: Date): ProductStatus {
  if (!rules.available || (rules.trackStock && (rules.stockQty ?? 0) <= 0)) {
    return { orderable: false, reason: "sold_out", note: "Esgotado" };
  }
  if (!inWindow(rules.windows, when)) {
    return { orderable: false, reason: "outside_window", note: windowNote(rules.windows) };
  }
  if (rules.minLeadMinutes > 0) {
    const hours = Math.round(rules.minLeadMinutes / 60);
    return { orderable: true, mustSchedule: true, note: `Encomenda com ${hours} hora${hours === 1 ? "" : "s"} de antecedência` };
  }
  return { orderable: true, mustSchedule: false, note: rules.windows.length > 0 ? windowNote(rules.windows) : null };
}

/** Primeiro momento para o qual um pedido com estas antecedências pode ser agendado. */
export function earliestSchedule(now: Date, leadMinutes: number[], storeMinLeadMinutes: number): Date {
  return new Date(now.getTime() + Math.max(storeMinLeadMinutes, ...leadMinutes, 0) * MINUTE_MS);
}

export type SameDayRule = {
  /** "11:00": os pedidos para hoje fecham neste horário (quentinhas). */
  cutoff: string | null;
};

/** Depois do horário limite, os pedidos de hoje fecham e só resta agendar para outro dia. */
export function sameDayClosed(rule: SameDayRule, now: Date): boolean {
  if (!rule.cutoff) return false;
  return toLocal(now).minutes >= parseTime(rule.cutoff);
}

export const SAME_DAY_CLOSED_MESSAGE = "Os pedidos de hoje já fecharam. Quer agendar para amanhã?";

/** A faixa de entrega de uma data local, para lojas que entregam em faixa fixa. */
export function deliveryWindow(date: string, start: string, end: string): { start: Date; end: Date } {
  return { start: fromLocal(date, parseTime(start)), end: fromLocal(date, parseTime(end)) };
}
