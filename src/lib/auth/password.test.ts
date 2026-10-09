import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("accepts the right password and rejects the wrong one", () => {
    const stored = hashPassword("admin");
    expect(verifyPassword("admin", stored)).toBe(true);
    expect(verifyPassword("Admin", stored)).toBe(false);
  });

  it("never stores the password itself and salts every hash", () => {
    const first = hashPassword("admin");
    expect(first).not.toContain("admin");
    expect(hashPassword("admin")).not.toBe(first);
  });

  it("rejects missing or malformed hashes", () => {
    expect(verifyPassword("admin", null)).toBe(false);
    expect(verifyPassword("admin", "admin")).toBe(false);
  });
});
