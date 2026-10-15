import { describe, expect, it, vi } from "vitest";
import { sweepExpiredSessions } from "../src/auth/session-cleanup.js";

describe("expired session maintenance", () => {
  it("stops when a batch is incomplete", async () => {
    const deleteExpiredSessions = vi.fn().mockResolvedValueOnce(100).mockResolvedValueOnce(2);
    const deleted = await sweepExpiredSessions({ deleteExpiredSessions }, new Date(0));
    expect(deleted).toBe(102);
    expect(deleteExpiredSessions).toHaveBeenCalledTimes(2);
  });

  it("caps a sweep at one thousand rows", async () => {
    const deleteExpiredSessions = vi.fn().mockResolvedValue(100);
    const deleted = await sweepExpiredSessions({ deleteExpiredSessions }, new Date(0));
    expect(deleted).toBe(1_000);
    expect(deleteExpiredSessions).toHaveBeenCalledTimes(10);
  });
});
