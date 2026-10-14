import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, temporaryPassword, verifyPassword } from "./password";

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

describe("new passwords", () => {
  it("asks for at least 8 characters and refuses the obvious ones", () => {
    expect(passwordProblem("abc123")).toMatch(/pelo menos 8/);
    expect(passwordProblem("11111111")).toMatch(/fácil/);
    expect(passwordProblem("12345678")).toMatch(/fácil/);
    expect(passwordProblem("pizza-de-sexta")).toBeNull();
    expect(passwordProblem("x".repeat(73))).toMatch(/no máximo/);
  });

  it("creates temporary passwords with 8 digits", () => {
    const password = temporaryPassword();
    expect(password).toMatch(/^\d{8}$/);
    expect(verifyPassword(password, hashPassword(password))).toBe(true);
  });
});
