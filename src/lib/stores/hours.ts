// Is the store open right now, and if not, when does it open? Pure functions.
import { DAY_MS, formatHour, fromLocal, parseTime, toLocal, WEEKDAY_NAMES } from "../time.ts";

export type Shift = {
  weekday: number;
  /** "HH:MM" or "HH:MM:SS". A closing time at or before the opening crosses midnight. */
  opensAt: string;
  closesAt: string;
  pickupOnly?: boolean;
};

export type StoreSchedule = {
  status: "pending" | "active" | "paused" | "suspended";
  manualState: "auto" | "open" | "closed";
  pausedUntil: Date | null;
  shifts: Shift[];
  closures: { startsAt: Date; endsAt: Date }[];
};

export type StoreAvailability = {
  state: "open" | "closed" | "paused";
  /** The current shift only allows pickup at the counter. */
  pickupOnly: boolean;
  /** When the current shift ends (only while open by the timetable). */
  closesAt: Date | null;
  /** Next opening by the timetable, when known. */
  opensAt: Date | null;
  /** "Aberta", "Abre hoje às 18h", "Abre amanhã às 6h", "Voltamos às 19h30"... */
  label: string;
};

type Interval = { start: Date; end: Date; pickupOnly: boolean };

/** Every shift as real instants, from yesterday (it may cross midnight) up to a week ahead. */
function intervals(shifts: Shift[], now: Date): Interval[] {
  const result: Interval[] = [];
  for (let offset = -1; offset <= 7; offset += 1) {
    const day = toLocal(new Date(now.getTime() + offset * DAY_MS));
    for (const shift of shifts) {
      if (shift.weekday !== day.weekday) continue;
      const open = parseTime(shift.opensAt);
      const close = parseTime(shift.closesAt);
      result.push({
        start: fromLocal(day.date, open),
        end: fromLocal(day.date, close <= open ? close + 24 * 60 : close),
        pickupOnly: shift.pickupOnly ?? false,
      });
    }
  }
  return result.sort((a, b) => a.start.getTime() - b.start.getTime());
}

const inClosure = (schedule: StoreSchedule, at: Date) =>
  schedule.closures.find((closure) => closure.startsAt <= at && at < closure.endsAt);

function opensLabel(opensAt: Date, now: Date): string {
  const today = toLocal(now);
  const target = toLocal(opensAt);
  const days = Math.round((Date.parse(target.date) - Date.parse(today.date)) / DAY_MS);
  const hour = formatHour(target.minutes);
  if (days === 0) return `Abre hoje às ${hour}`;
  if (days === 1) return `Abre amanhã às ${hour}`;
  return `Abre ${WEEKDAY_NAMES[target.weekday]} às ${hour}`;
}

export function storeAvailability(schedule: StoreSchedule, now: Date): StoreAvailability {
  const all = intervals(schedule.shifts, now);
  const current = all.find((interval) => interval.start <= now && now < interval.end);

  // Next opening by the timetable, skipping special closures (holidays).
  let opensAt: Date | null = null;
  for (const interval of all) {
    if (interval.start <= now) continue;
    const closure = inClosure(schedule, interval.start);
    if (!closure) { opensAt = interval.start; break; }
    if (closure.endsAt < interval.end) { opensAt = closure.endsAt; break; }
  }

  const closed = (label: string, state: "closed" | "paused" = "closed"): StoreAvailability => ({
    state, pickupOnly: false, closesAt: null, opensAt, label,
  });

  if (schedule.status === "pending" || schedule.status === "suspended") return closed("Indisponível");

  if (schedule.pausedUntil && schedule.pausedUntil > now) {
    return { ...closed(`Voltamos às ${formatHour(toLocal(schedule.pausedUntil).minutes)}`, "paused"), opensAt: schedule.pausedUntil };
  }
  if (schedule.status === "paused") return closed("Pausada no momento", "paused");

  if (schedule.manualState === "closed") return closed(opensAt ? opensLabel(opensAt, now) : "Fechada agora");
  if (schedule.manualState === "open") {
    return { state: "open", pickupOnly: current?.pickupOnly ?? false, closesAt: current?.end ?? null, opensAt: null, label: "Aberta" };
  }

  const closure = inClosure(schedule, now);
  if (current && !closure) {
    return { state: "open", pickupOnly: current.pickupOnly, closesAt: current.end, opensAt: null, label: "Aberta" };
  }
  // A closure that ends in the middle of a shift reopens the store then.
  if (current && closure && closure.endsAt < current.end) opensAt = closure.endsAt;

  return closed(opensAt ? opensLabel(opensAt, now) : "Fechada");
}
