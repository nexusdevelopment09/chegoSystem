// Can this product be ordered now (or for a scheduled time)? Pure functions.
import { formatHour, fromLocal, MINUTE_MS, parseTime, toLocal, WEEKDAY_NAMES } from "../time.ts";

export type AvailabilityWindow = { weekday: number; startsAt: string; endsAt: string };

export type ProductRules = {
  available: boolean;
  trackStock: boolean;
  stockQty: number | null;
  /** Made-to-order: minutes of notice the store needs. */
  minLeadMinutes: number;
  /** No windows = every day, all day. */
  windows: AvailabilityWindow[];
};

export type ProductStatus =
  | { orderable: true; mustSchedule: boolean; note: string | null }
  | { orderable: false; reason: "sold_out" | "outside_window"; note: string };

/** True when the product is offered at that moment (day and time window). */
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
 * `when` is the moment the order would be prepared: now for an immediate
 * order, or the scheduled time.
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

/** Earliest moment an order with these lead times can be scheduled for. */
export function earliestSchedule(now: Date, leadMinutes: number[], storeMinLeadMinutes: number): Date {
  return new Date(now.getTime() + Math.max(storeMinLeadMinutes, ...leadMinutes, 0) * MINUTE_MS);
}

export type SameDayRule = {
  /** "11:00": orders for today close at this time (lunch boxes). */
  cutoff: string | null;
};

/** After the cutoff, today's orders are closed and only scheduling for another day is left. */
export function sameDayClosed(rule: SameDayRule, now: Date): boolean {
  if (!rule.cutoff) return false;
  return toLocal(now).minutes >= parseTime(rule.cutoff);
}

export const SAME_DAY_CLOSED_MESSAGE = "Os pedidos de hoje já fecharam. Quer agendar para amanhã?";

/** The delivery window of a given local date, for stores that deliver in a fixed window. */
export function deliveryWindow(date: string, start: string, end: string): { start: Date; end: Date } {
  return { start: fromLocal(date, parseTime(start)), end: fromLocal(date, parseTime(end)) };
}
