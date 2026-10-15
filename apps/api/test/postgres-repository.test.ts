import { describe, expect, it } from "vitest";
import { createLogger } from "../src/observability/log.js";
import { createPostgresRepository } from "../src/db/postgres-repository.js";

describe("PostgreSQL pool handling", () => {
  it("handles idle client errors without recording sensitive messages", async () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));
    const { pool } = createPostgresRepository("postgresql://synthetic:synthetic@127.0.0.1:1/none_test", logger);
    const error = Object.assign(new Error("params: synthetic@example.test,scrypt$16384$x"), { code: "57P01" });
    expect(() => pool.emit("error", error, {})).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "pg_idle_client_error", pgCode: "57P01", errorName: "Error" });
    expect(lines[0]).not.toContain("synthetic@example.test");
    expect(lines[0]).not.toContain("scrypt$");
    expect(pool.options.query_timeout).toBe(5_000);
    expect(pool.options.statement_timeout).toBe(5_000);
    await pool.end();
  });
});
