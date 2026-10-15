import { createServer, type Server, type Socket } from "node:net";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../src/auth/session.js";
import { createPostgresRepository } from "../src/db/postgres-repository.js";
import { createApp } from "../src/http/app.js";
import { createLogger } from "../src/observability/log.js";

const ORIGIN = "http://127.0.0.1:5173";
const SYNTHETIC_COOKIE = `${SESSION_COOKIE_NAME}=${"A".repeat(43)}`;

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No TCP address"));
      resolve(address.port);
    });
  });
}

/** Looks up a session through the real pg pool and Drizzle, returning the response and the logged reason. */
async function sessionLookup(port: number) {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line));
  const { repository, pool } = createPostgresRepository(`postgresql://synthetic:synthetic@127.0.0.1:${port}/none_test`, logger);
  try {
    const app = createApp({ repository, frontendOrigins: [ORIGIN], logger });
    const started = Date.now();
    const response = await request(app).get("/api/auth/me").set("Cookie", SYNTHETIC_COOKIE);
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    return { response, ms: Date.now() - started, reason: events.find((entry) => entry.event === "database_unavailable")?.reason, lines };
  } finally {
    await pool.end();
  }
}

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

  it("reports a silent PostgreSQL peer as 503 database_unavailable after the connection timeout", async () => {
    // Accepts TCP connections and never answers, like a paused database container.
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
    });
    const port = await listenOnLoopback(server);
    try {
      const { response, ms, reason, lines } = await sessionLookup(port);
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("database_unavailable");
      expect(response.headers["retry-after"]).toBe("5");
      expect(reason).toBe("connect_timeout");
      expect(ms).toBeGreaterThanOrEqual(2_900);
      expect(ms).toBeLessThan(4_500);
      expect(lines.join("")).not.toContain(`127.0.0.1:${port}`);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  }, 10_000);

  it("reports a refused PostgreSQL port as 503 database_unavailable", async () => {
    // Reserve a free loopback port, then close it so the connection is refused.
    const server = createServer();
    const port = await listenOnLoopback(server);
    await new Promise((resolve) => server.close(resolve));
    const { response, reason, lines } = await sessionLookup(port);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("database_unavailable");
    expect(reason).toBe("connect_failed");
    expect(lines.join("")).not.toContain(`127.0.0.1:${port}`);
  }, 10_000);
});
