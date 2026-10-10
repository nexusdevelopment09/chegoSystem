// Para quando um pedido pode ser agendado? Funções puras.
import { storeAvailability, type StoreSchedule } from "../stores/hours.ts";
import { DAY_MS, formatHour, fromLocal, MINUTE_MS, parseTime, toLocal, WEEKDAY_NAMES } from "../time.ts";

export type ScheduleRules = {
  acceptsScheduled: boolean;
  /** Antecedência mínima que a loja pede, em minutos. */
  minLeadMinutes: number;
  maxDays: number;
  /** Regra da quentinha: os pedidos para o mesmo dia fecham neste horário ("11:00"). */
  sameDayCutoff: string | null;
  /** Entregas só dentro desta faixa ("11:30" a "13:30"). */
  windowStart: string | null;
  windowEnd: string | null;
};

export type Slot = { value: string; label: string };

const STEP_MINUTES = 30;

function dayLabel(date: Date, now: Date): string {
  const days = Math.round((Date.parse(toLocal(date).date) - Date.parse(toLocal(now).date)) / DAY_MS);
  if (days === 0) return "Hoje";
  if (days === 1) return "Amanhã";
  const [, month, day] = toLocal(date).date.split("-");
  return `${WEEKDAY_NAMES[toLocal(date).weekday].replace(/^./, (letter) => letter.toUpperCase())}, ${day}/${month}`;
}

export const slotLabel = (date: Date, now: Date) => `${dayLabel(date, now)} às ${formatHour(toLocal(date).minutes)}`;

/**
 * Horários que o cliente pode escolher, de 30 em 30 minutos: dentro do horário
 * de funcionamento da loja (ou da faixa de entrega), depois da antecedência necessária.
 * `productLeadMinutes` é a maior antecedência entre os produtos da sacola.
 */
export function scheduleSlots(
  rules: ScheduleRules,
  schedule: StoreSchedule,
  now: Date,
  productLeadMinutes: number,
): Slot[] {
  if (!rules.acceptsScheduled) return [];
  const earliest = now.getTime() + Math.max(rules.minLeadMinutes, productLeadMinutes) * MINUTE_MS;
  const today = toLocal(now);
  const slots: Slot[] = [];

  for (let offset = 0; offset <= rules.maxDays; offset += 1) {
    const day = toLocal(new Date(now.getTime() + offset * DAY_MS));
    // Depois do horário limite, hoje está fechado para as lojas que trabalham com um.
    if (offset === 0 && rules.sameDayCutoff && today.minutes >= parseTime(rules.sameDayCutoff)) continue;

    for (const shift of schedule.shifts.filter((item) => item.weekday === day.weekday)) {
      const open = parseTime(shift.opensAt);
      const rawClose = parseTime(shift.closesAt);
      const close = rawClose <= open ? rawClose + 24 * 60 : rawClose;
      const from = rules.windowStart ? parseTime(rules.windowStart) : open + STEP_MINUTES;
      const to = rules.windowEnd ? parseTime(rules.windowEnd) : close;

      for (let minutes = Math.ceil(from / STEP_MINUTES) * STEP_MINUTES; minutes <= to; minutes += STEP_MINUTES) {
        const at = fromLocal(day.date, minutes);
        if (at.getTime() < earliest) continue;
        if (schedule.closures.some((closure) => closure.startsAt <= at && at < closure.endsAt)) continue;
        slots.push({ value: at.toISOString(), label: slotLabel(at, now) });
      }
    }
  }

  const unique = new Map(slots.map((slot) => [slot.value, slot]));
  return [...unique.values()].sort((a, b) => a.value.localeCompare(b.value));
}

/** Este horário exato é um dos oferecidos? */
export function isValidSlot(slots: Slot[], scheduledFor: Date): boolean {
  return slots.some((slot) => slot.value === scheduledFor.toISOString());
}

export type NowCheck = { allowed: true } | { allowed: false; reason: string };

/** A loja pode receber um pedido para preparar agora mesmo? */
export function canOrderNow(
  rules: ScheduleRules,
  schedule: StoreSchedule,
  now: Date,
  hasMadeToOrder: boolean,
): NowCheck {
  const availability = storeAvailability(schedule, now);
  if (availability.state !== "open") {
    return {
      allowed: false,
      reason: rules.acceptsScheduled
        ? `Eita, essa loja está fechada agora (${availability.label.toLowerCase()}). Você pode agendar.`
        : "Eita, essa loja fechou agora. Volta mais tarde?",
    };
  }
  if (hasMadeToOrder) return { allowed: false, reason: "Seu carrinho tem encomenda: escolha a data e a hora." };
  if (rules.sameDayCutoff && toLocal(now).minutes >= parseTime(rules.sameDayCutoff)) {
    return { allowed: false, reason: "Os pedidos de hoje já fecharam. Quer agendar para amanhã?" };
  }
  return { allowed: true };
}
