import { describe, expect, it } from "vitest";
import { formatCents, formatPhone, toE164 } from "./format";

describe("formatCents", () => {
  it("formats cents as BRL", () => {
    expect(formatCents(123456)).toBe("R$ 1.234,56");
    expect(formatCents(0)).toBe("R$ 0,00");
    expect(formatCents(5)).toBe("R$ 0,05");
  });
});

describe("formatPhone", () => {
  it("formats mobile and landline numbers", () => {
    expect(formatPhone("+5582900000001")).toBe("(82) 90000-0001");
    expect(formatPhone("82900000001")).toBe("(82) 90000-0001");
    expect(formatPhone("8232221111")).toBe("(82) 3222-1111");
  });

  it("returns the input when it is not a Brazilian phone", () => {
    expect(formatPhone("123")).toBe("123");
  });
});

describe("toE164", () => {
  it("normalizes Brazilian phones", () => {
    expect(toE164("(82) 90000-0001")).toBe("+5582900000001");
    expect(toE164("+55 82 90000-0001")).toBe("+5582900000001");
  });

  it("rejects invalid phones", () => {
    expect(toE164("90000-0001")).toBeNull();
  });
});
