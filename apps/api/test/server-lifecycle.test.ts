import { createServer as createNetServer } from "node:net";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { createShutdown, startServer } from "../src/http/server-lifecycle.js";

describe("HTTP server lifecycle", () => {
  it("rejects when the port is already in use", async () => {
    const occupied = createNetServer();
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("expected TCP port");
    try {
      await expect(startServer(express(), { host: "127.0.0.1", port: address.port })).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });

  it("waits for an active request before ending the database pool", async () => {
    let entered!: () => void;
    let release!: () => void;
    const requestStarted = new Promise<void>((resolve) => { entered = resolve; });
    const continueRequest = new Promise<void>((resolve) => { release = resolve; });
    const app = express();
    app.get("/slow", async (_req, res) => {
      entered();
      await continueRequest;
      res.sendStatus(200);
    });
    const server = await startServer(app, { host: "127.0.0.1", port: 0 });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP port");
    const events: string[] = [];
    const pool = { end: vi.fn(async () => { events.push("pool.end"); }) };
    const exit = vi.fn();
    const shutdown = createShutdown({ server, pool, graceMs: 2_000, exit });
    const responsePromise = fetch(`http://127.0.0.1:${address.port}/slow`);
    await requestStarted;
    const stopPromise = shutdown("SIGTERM");
    expect(pool.end).not.toHaveBeenCalled();
    release();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    await response.text();
    await stopPromise;
    expect(events).toEqual(["pool.end"]);
    expect(server.listening).toBe(false);
    expect(exit).not.toHaveBeenCalled();
  });

  it("forces a second shutdown signal without ending the pool twice", async () => {
    const server = await startServer(express(), { host: "127.0.0.1", port: 0 });
    const exit = vi.fn();
    const pool = { end: vi.fn(async () => {}) };
    const shutdown = createShutdown({ server, pool, exit });
    const first = shutdown("SIGINT");
    await shutdown("SIGTERM");
    await first;
    expect(exit).toHaveBeenCalledWith(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("forces connections closed when the grace deadline expires", async () => {
    let entered!: () => void;
    const requestStarted = new Promise<void>((resolve) => { entered = resolve; });
    const app = express();
    app.get("/stuck", (_req, res) => {
      res.writeHead(200);
      res.write("partial");
      entered();
    });
    const server = await startServer(app, { host: "127.0.0.1", port: 0 });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP port");
    const responsePromise = fetch(`http://127.0.0.1:${address.port}/stuck`);
    await requestStarted;
    const response = await responsePromise;
    const body = response.text().catch(() => "disconnected");
    const exit = vi.fn();
    const pool = { end: vi.fn(async () => {}) };
    await createShutdown({ server, pool, graceMs: 50, exit })("SIGTERM");
    expect(exit).toHaveBeenCalledWith(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(await body).toBe("disconnected");
  });
});
