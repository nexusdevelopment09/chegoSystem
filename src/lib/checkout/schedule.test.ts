import { describe, expect, it } from "vitest";
import type { Shift, StoreSchedule } from "../stores/hours";
import { canOrderNow, isValidSlot, scheduleSlots, type ScheduleRules } from "./schedule";

// 2026-10-09 is a Friday. Maceió time.
const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);
const days = (list: number[], opensAt: string, closesAt: string): Shift[] =>
  list.map((weekday) => ({ weekday, opensAt, closesAt }));
const schedule = (shifts: Shift[]): StoreSchedule => ({ status: "active", manualState: "auto", pausedUntil: null, shifts, closures: [] });
const rules = (extra: Partial<ScheduleRules> = {}): ScheduleRules => ({
  acceptsScheduled: true, minLeadMinutes: 60, maxDays: 7, sameDayCutoff: null, windowStart: null, windowEnd: null, ...extra,
});

describe("quentinha: pedidos até 11h, entrega entre 11h30 e 13h30", () => {
  const lunch = schedule(days([1, 2, 3, 4, 5, 6], "09:00", "14:00"));
  const lunchRules = rules({ sameDayCutoff: "11:00", windowStart: "11:30", windowEnd: "13:30" });

  it("before 11h the customer can order for today", () => {
    const now = at("2026-10-09", "10:00");
    expect(canOrderNow(lunchRules, lunch, now, false)).toEqual({ allowed: true });
    const slots = scheduleSlots(lunchRules, lunch, now, 0);
    expect(slots.slice(0, 5).map((slot) => slot.label)).toEqual([
      "Hoje às 11h30", "Hoje às 12h", "Hoje às 12h30", "Hoje às 13h", "Hoje às 13h30",
    ]);
  });

  it("after 11h only tomorrow is offered", () => {
    const now = at("2026-10-09", "11:05");
    expect(canOrderNow(lunchRules, lunch, now, false)).toEqual({
      allowed: false, reason: "Os pedidos de hoje já fecharam. Quer agendar para amanhã?",
    });
    const slots = scheduleSlots(lunchRules, lunch, now, 0);
    expect(slots[0].label).toBe("Amanhã às 11h30");
    // Closed on Sunday: after Saturday comes Monday.
    expect(slots.some((slot) => slot.label.startsWith("Domingo"))).toBe(false);
    expect(slots[5].label).toBe("Segunda, 12/10 às 11h30");
  });
});

describe("encomendas e loja fechada", () => {
  const bakery = schedule(days([1, 2, 3, 4, 5, 6], "08:00", "19:00"));

  it("a 24-hour product pushes the first slot to tomorrow at the same time", () => {
    const now = at("2026-10-09", "10:10");
    const slots = scheduleSlots(rules(), bakery, now, 24 * 60);
    expect(slots[0].label).toBe("Amanhã às 10h30");
    expect(canOrderNow(rules(), bakery, now, true)).toMatchObject({ allowed: false });
    expect(isValidSlot(slots, at("2026-10-10", "10:30"))).toBe(true);
    expect(isValidSlot(slots, at("2026-10-10", "10:00"))).toBe(false);
    expect(isValidSlot(slots, at("2026-10-10", "10:45"))).toBe(false);
  });

  it("a closed store can still take a scheduled order, if it accepts scheduling", () => {
    const now = at("2026-10-09", "22:00");
    expect(canOrderNow(rules(), bakery, now, false)).toEqual({
      allowed: false, reason: "Eita, essa loja está fechada agora (abre amanhã às 8h). Você pode agendar.",
    });
    expect(scheduleSlots(rules(), bakery, now, 0)[0].label).toBe("Amanhã às 8h30");

    const noScheduling = rules({ acceptsScheduled: false });
    expect(canOrderNow(noScheduling, bakery, now, false)).toEqual({
      allowed: false, reason: "Eita, essa loja fechou agora. Volta mais tarde?",
    });
    expect(scheduleSlots(noScheduling, bakery, now, 0)).toEqual([]);
  });

  it("offers no slot during a holiday and none beyond the store's limit", () => {
    const now = at("2026-10-09", "07:00");
    const holiday: StoreSchedule = { ...bakery, closures: [{ startsAt: at("2026-10-10", "00:00"), endsAt: at("2026-10-11", "00:00") }] };
    const slots = scheduleSlots(rules({ maxDays: 2 }), holiday, now, 0);
    expect(slots.every((slot) => slot.label.startsWith("Hoje"))).toBe(true);
    expect(slots.at(-1)!.label).toBe("Hoje às 19h");
  });
});
