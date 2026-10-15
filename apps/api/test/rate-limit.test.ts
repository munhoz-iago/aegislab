import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { makeRateLimiter } from "../src/http/rate-limit.js";
import { createApp } from "../src/http/app.js";
import type { AuthRepository } from "../src/auth/repository.js";

const ORIGIN = "http://127.0.0.1:5173";

describe("authentication rate limit", () => {
  it("allows ten login attempts per window and resets after ten minutes", async () => {
    let now = 1_000;
    const repository = { ping: async () => {} } as AuthRepository;
    const app = createApp({ repository, frontendOrigins: [ORIGIN], now: () => now });
    for (let index = 0; index < 10; index += 1) {
      expect((await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "bad", password: "short" })).status).toBe(400);
    }
    const limited = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "bad", password: "short" });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("600");
    now += 600_000;
    expect((await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "bad", password: "short" })).status).toBe(400);
  });

  it("evicts the oldest key when its bounded store fills", async () => {
    const app = express();
    app.use((req, _res, next) => {
      Object.defineProperty(req.socket, "remoteAddress", { value: req.get("X-Test-Client"), configurable: true });
      next();
    });
    app.get("/", makeRateLimiter(1, { maxKeys: 2 }), (_req, res) => res.sendStatus(204));
    for (const client of ["192.0.2.1", "192.0.2.2", "192.0.2.3", "192.0.2.1"]) {
      expect((await request(app).get("/").set("X-Test-Client", client)).status).toBe(204);
    }
  });
});
