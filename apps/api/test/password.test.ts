import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

describe("password storage", () => {
  it("uses a unique salt and verifies only the matching password", async () => {
    const first = await hashPassword("a safe synthetic password");
    const second = await hashPassword("a safe synthetic password");
    expect(first).not.toBe(second);
    expect(first).not.toContain("a safe synthetic password");
    expect(await verifyPassword("a safe synthetic password", first)).toBe(true);
    expect(await verifyPassword("a different synthetic password", first)).toBe(false);
    expect(await verifyPassword("a safe synthetic password", "malformed")).toBe(false);
  });
});
