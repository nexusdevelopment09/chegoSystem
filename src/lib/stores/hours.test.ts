import { describe, expect, it } from "vitest";
import { storeAvailability, type Shift, type StoreSchedule } from "./hours";

// 09/10/2026 é uma sexta. Os horários abaixo são de Maceió (UTC-3).
const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);
const everyDay = (opensAt: string, closesAt: string): Shift[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt, closesAt }));

const schedule = (shifts: Shift[], extra: Partial<StoreSchedule> = {}): StoreSchedule => ({
  status: "active", manualState: "auto", pausedUntil: null, shifts, closures: [], ...extra,
});

describe("storeAvailability", () => {
  const dinner = schedule(everyDay("18:00", "23:30"));

  it("is open inside the shift and closed outside it", () => {
    expect(storeAvailability(dinner, at("2026-10-09", "19:00"))).toMatchObject({ state: "open", label: "Aberta" });
    expect(storeAvailability(dinner, at("2026-10-09", "23:30")).state).toBe("closed");
    expect(storeAvailability(dinner, at("2026-10-09", "17:59")).state).toBe("closed");
  });

  it("says when it opens: today, tomorrow or on a weekday", () => {
    expect(storeAvailability(dinner, at("2026-10-09", "10:00")).label).toBe("Abre hoje às 18h");
    expect(storeAvailability(dinner, at("2026-10-09", "23:45")).label).toBe("Abre amanhã às 18h");

    // Fechada segunda e terça (Sushi Maré): no domingo à noite a próxima abertura é na quarta.
    const sushi = schedule([3, 4, 5, 6, 0].map((weekday) => ({ weekday, opensAt: "18:00", closesAt: "23:00" })));
    expect(storeAvailability(sushi, at("2026-10-11", "23:30")).label).toBe("Abre quarta às 18h");
    expect(storeAvailability(sushi, at("2026-10-12", "20:00")).state).toBe("closed");
  });

  it("handles two shifts on the same day", () => {
    const bakery = schedule([...everyDay("05:30", "11:00"), ...everyDay("15:00", "20:00")]);
    expect(storeAvailability(bakery, at("2026-10-09", "06:00")).state).toBe("open");
    expect(storeAvailability(bakery, at("2026-10-09", "12:00"))).toMatchObject({ state: "closed", label: "Abre hoje às 15h" });
    expect(storeAvailability(bakery, at("2026-10-09", "16:00")).state).toBe("open");
    expect(storeAvailability(bakery, at("2026-10-09", "21:00")).label).toBe("Abre amanhã às 5h30");
  });

  it("handles a shift that crosses midnight", () => {
    const depot = schedule(everyDay("09:00", "02:00"));
    expect(storeAvailability(depot, at("2026-10-10", "01:30")).state).toBe("open");
    expect(storeAvailability(depot, at("2026-10-10", "02:00")).state).toBe("closed");
    expect(storeAvailability(depot, at("2026-10-10", "03:00")).label).toBe("Abre hoje às 9h");

    const burger = schedule(everyDay("18:00", "00:00"));
    expect(storeAvailability(burger, at("2026-10-09", "23:59")).state).toBe("open");
    expect(storeAvailability(burger, at("2026-10-10", "00:00")).state).toBe("closed");
  });

  it("closes for a holiday and skips it when telling the next opening", () => {
    const holiday = schedule(everyDay("07:00", "17:00"), {
      closures: [{ startsAt: at("2026-10-09", "00:00"), endsAt: at("2026-10-10", "00:00") }],
    });
    expect(storeAvailability(holiday, at("2026-10-09", "10:00"))).toMatchObject({ state: "closed", label: "Abre amanhã às 7h" });
    expect(storeAvailability(holiday, at("2026-10-08", "18:00")).label).toBe("Abre sábado às 7h");
    expect(storeAvailability(holiday, at("2026-10-10", "10:00")).state).toBe("open");
  });

  it("respects the open/close now button", () => {
    expect(storeAvailability({ ...dinner, manualState: "closed" }, at("2026-10-09", "19:00"))).toMatchObject({
      state: "closed", label: "Abre amanhã às 18h",
    });
    expect(storeAvailability({ ...dinner, manualState: "open" }, at("2026-10-09", "10:00")).state).toBe("open");
  });

  it("shows a pause with the time it comes back", () => {
    const paused = { ...dinner, pausedUntil: at("2026-10-09", "19:30") };
    expect(storeAvailability(paused, at("2026-10-09", "19:00"))).toMatchObject({ state: "paused", label: "Voltamos às 19h30" });
    expect(storeAvailability(paused, at("2026-10-09", "19:31")).state).toBe("open");
    expect(storeAvailability({ ...dinner, status: "paused" }, at("2026-10-09", "19:00")).label).toBe("Pausada no momento");
  });

  it("marks pickup-only shifts and hides stores that are not approved", () => {
    const fishShop = schedule([{ weekday: 0, opensAt: "07:00", closesAt: "17:00", pickupOnly: true }]);
    expect(storeAvailability(fishShop, at("2026-10-11", "09:00"))).toMatchObject({ state: "open", pickupOnly: true });
    expect(storeAvailability({ ...dinner, status: "suspended" }, at("2026-10-09", "19:00")).state).toBe("closed");
  });
});
