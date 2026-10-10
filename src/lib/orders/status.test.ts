import { describe, expect, it } from "vitest";
import { ALL_STATUSES, canTransition, nextStatuses, type Actor, type OrderStatus } from "./status";

const ACTORS: Actor[] = ["system", "customer", "staff", "courier", "admin"];

// Todas as transições permitidas, escritas uma a uma. Qualquer outra tem que ser recusada.
const ALLOWED: [OrderStatus, OrderStatus, Actor[], ("delivery" | "pickup")?][] = [
  ["awaiting_payment", "paid", ["system"]],
  ["awaiting_payment", "expired", ["system"]],
  ["awaiting_payment", "cancelled", ["customer", "admin"]],
  ["paid", "accepted", ["staff"]],
  ["paid", "rejected", ["staff", "system"]],
  ["paid", "cancelled", ["customer", "admin"]],
  ["accepted", "preparing", ["staff"]],
  ["accepted", "cancelled", ["admin"]],
  ["preparing", "ready", ["staff"]],
  ["preparing", "cancelled", ["admin"]],
  ["ready", "out_for_delivery", ["staff"], "delivery"],
  ["ready", "picked_up", ["staff"], "pickup"],
  ["ready", "cancelled", ["admin"]],
  ["out_for_delivery", "delivered", ["courier", "staff", "admin"], "delivery"],
  ["out_for_delivery", "cancelled", ["admin"]],
  ["delivered", "refunded", ["admin"]],
  ["delivered", "partially_refunded", ["admin", "system"]],
  ["picked_up", "refunded", ["admin"]],
  ["picked_up", "partially_refunded", ["admin", "system"]],
  ["partially_refunded", "refunded", ["admin"]],
  ["partially_refunded", "partially_refunded", ["admin"]],
];

describe("order state machine", () => {
  it("allows exactly the listed transitions, and nothing else", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        for (const actor of ACTORS) {
          for (const fulfillment of ["delivery", "pickup"] as const) {
            const rule = ALLOWED.find(([a, b]) => a === from && b === to);
            const expected = Boolean(rule && rule[2].includes(actor) && (!rule[3] || rule[3] === fulfillment));
            expect(canTransition(from, to, actor, fulfillment), `${from} -> ${to} by ${actor} (${fulfillment})`).toBe(expected);
          }
        }
      }
    }
  });

  it("only the payment confirmation (system) turns an order into paid", () => {
    for (const actor of ["customer", "staff", "courier", "admin"] as const) {
      expect(canTransition("awaiting_payment", "paid", actor, "delivery")).toBe(false);
    }
  });

  it("the customer can cancel only until the store accepts", () => {
    expect(canTransition("paid", "cancelled", "customer", "delivery")).toBe(true);
    for (const from of ["accepted", "preparing", "ready", "out_for_delivery"] as const) {
      expect(canTransition(from, "cancelled", "customer", "delivery")).toBe(false);
    }
  });

  it("finished orders go nowhere", () => {
    for (const from of ["expired", "rejected", "cancelled", "refunded"] as const) {
      for (const actor of ACTORS) expect(nextStatuses(from, actor, "delivery")).toEqual([]);
    }
  });

  it("follows delivery or pickup after ready, never both", () => {
    expect(nextStatuses("ready", "staff", "delivery")).toEqual(["out_for_delivery"]);
    expect(nextStatuses("ready", "staff", "pickup")).toEqual(["picked_up"]);
    expect(canTransition("out_for_delivery", "delivered", "courier", "delivery")).toBe(true);
  });
});
