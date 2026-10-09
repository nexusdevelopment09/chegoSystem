// Calendar helpers in Maceió time. The city is UTC-3 all year (no daylight
// saving time), so a fixed offset is exact. Pure functions.

const OFFSET_MS = 3 * 60 * 60 * 1000;
export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

export type LocalTime = {
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  /** Minutes since midnight. */
  minutes: number;
  /** "2026-10-09". */
  date: string;
};

export function toLocal(date: Date): LocalTime {
  const shifted = new Date(date.getTime() - OFFSET_MS);
  return {
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    date: shifted.toISOString().slice(0, 10),
  };
}

/** The instant of a local date ("2026-10-09") at a number of minutes past midnight. */
export function fromLocal(date: string, minutes: number): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + OFFSET_MS + minutes * MINUTE_MS);
}

/** "18:30" or "18:30:00" -> 1110. */
export function parseTime(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** 1080 -> "18h", 1110 -> "18h30". */
export function formatHour(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
}

export const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
