import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { DuplicateEmailError, type AuthRepository, type PublicUser, type StoredUser } from "../src/auth/repository.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../src/auth/session.js";
import { createApp } from "../src/http/app.js";
import { createLogger } from "../src/observability/log.js";

const ORIGIN = "http://127.0.0.1:5173";
const PASSWORD = "correct horse battery staple";

class MemoryRepository implements AuthRepository {
  users = new Map<string, StoredUser>();
  sessions = new Map<string, { userId: string; expiresAt: Date }>();
  databaseAvailable = true;

  async ping(): Promise<void> {
    if (!this.databaseAvailable) throw new Error("database unavailable");
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    return this.users.get(email) ?? null;
  }

  async findUserBySession(tokenHash: string, now: Date): Promise<PublicUser | null> {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= now) return null;
    const user = [...this.users.values()].find((value) => value.id === session.userId);
    return user ? { id: user.id, email: user.email, createdAt: user.createdAt } : null;
  }

  async createUser(email: string, passwordHash: string): Promise<StoredUser> {
    if (this.users.has(email)) throw new DuplicateEmailError();
    const user = { id: randomUUID(), email, passwordHash, createdAt: new Date() };
    this.users.set(email, user);
    return user;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async deleteExpiredSessions(now: Date): Promise<number> {
    let deleted = 0;
    for (const [tokenHash, session] of this.sessions) {
      if (deleted === 100) break;
      if (session.expiresAt <= now) {
        this.sessions.delete(tokenHash);
        deleted += 1;
      }
    }
    return deleted;
  }
}

describe("AegisLab API", () => {
  it("reports database readiness without claiming a scanner ran", async () => {
    const repository = new MemoryRepository();
    const app = createApp({ repository, frontendOrigins: [ORIGIN, "http://localhost:5173"] });
    expect((await request(app).get("/api/health")).body).toEqual({ status: "ok", database: "connected" });
    repository.databaseAvailable = false;
    const unavailable = await request(app).get("/api/health");
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toEqual({ status: "degraded", database: "unavailable" });
  });

  it("requires the configured Origin on state changes", async () => {
    const repository = new MemoryRepository();
    const app = createApp({ repository, frontendOrigins: [ORIGIN, "http://localhost:5173"] });
    const body = { email: "user@example.com", password: PASSWORD };
    const missing = await request(app).post("/api/auth/register").send(body);
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe("origin_forbidden");
    const foreign = await request(app).post("/api/auth/register").set("Origin", "https://evil.example").send(body);
    expect(foreign.status).toBe(403);
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
    expect(repository.users.size).toBe(0);
  });

  it("stores only a session token hash and protects dashboard access", async () => {
    const repository = new MemoryRepository();
    const app = createApp({ repository, frontendOrigins: [ORIGIN, "http://localhost:5173"] });
    const browser = request.agent(app);

    const guest = await browser.get("/api/dashboard");
    expect(guest.status).toBe(401);
    expect(guest.body.error.code).toBe("unauthorized");

    const registered = await browser
      .post("/api/auth/register")
      .set("Origin", ORIGIN)
      .send({ email: "  USER@Example.com ", password: PASSWORD });
    expect(registered.status).toBe(201);
    expect(registered.body.user.email).toBe("user@example.com");
    expect(registered.body.user.passwordHash).toBeUndefined();
    const cookie = registered.headers["set-cookie"]?.[0] as string;
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api");
    const token = cookie.split(";")[0]?.split("=")[1] as string;
    expect(repository.sessions.has(token)).toBe(false);
    expect(repository.sessions.has(hashSessionToken(token))).toBe(true);

    const me = await browser.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("user@example.com");
    const dashboard = await browser.get("/api/dashboard");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.status).toBe("foundation");
    expect(dashboard.body.modules.find((module: { id: string }) => module.id === "security").status).toBe("planned");
    expect(dashboard.body.note).toMatch(/Nenhuma medição ou varredura/);

    const logout = await browser.post("/api/auth/logout").set("Origin", ORIGIN);
    expect(logout.status).toBe(204);
    expect(repository.sessions.has(hashSessionToken(token))).toBe(false);
    expect((await browser.get("/api/auth/me")).status).toBe(401);
  });

  it("uses generic login errors and rejects duplicate normalized email", async () => {
    const repository = new MemoryRepository();
    const app = createApp({ repository, frontendOrigins: [ORIGIN, "http://localhost:5173"] });
    await request(app).post("/api/auth/register").set("Origin", ORIGIN).send({ email: "User@Example.com", password: PASSWORD });
    const duplicate = await request(app).post("/api/auth/register").set("Origin", ORIGIN).send({ email: "user@example.com", password: PASSWORD });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("email_in_use");

    const missing = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "missing@example.com", password: PASSWORD });
    const wrong = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "user@example.com", password: "wrong password that is long" });
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(missing.body).toEqual(wrong.body);

    const success = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "USER@example.com", password: PASSWORD });
    expect(success.status).toBe(200);
    expect(success.body.user.email).toBe("user@example.com");
  });

  it("rejects expired sessions, malformed input, and oversized JSON", async () => {
    const repository = new MemoryRepository();
    const app = createApp({ repository, frontendOrigins: [ORIGIN, "http://localhost:5173"] });
    const registered = await request(app).post("/api/auth/register").set("Origin", ORIGIN).send({ email: "user@example.com", password: PASSWORD });
    const cookie = (registered.headers["set-cookie"]?.[0] as string).split(";")[0] as string;
    const token = cookie.split("=")[1] as string;
    repository.sessions.get(hashSessionToken(token))!.expiresAt = new Date(0);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);

    const invalid = await request(app).post("/api/auth/register").set("Origin", ORIGIN).send({ email: "invalid", password: "short" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("validation_error");
    const malformed = await request(app).post("/api/auth/register").set("Origin", ORIGIN).set("Content-Type", "application/json").send("{");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("invalid_json");
    const large = await request(app).post("/api/auth/register").set("Origin", ORIGIN).send({ email: "x@example.com", password: "a".repeat(17_000) });
    expect(large.status).toBe(413);
    expect(large.body.error.code).toBe("payload_too_large");
  });

  it("limits registration attempts by socket IP even with forged forwarding headers", async () => {
    const app = createApp({ repository: new MemoryRepository(), frontendOrigins: [ORIGIN, "http://localhost:5173"] });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app).post("/api/auth/register").set("Origin", ORIGIN).set("X-Forwarded-For", `192.0.2.${attempt}`).send({ email: "bad", password: "short" });
      expect(response.status).toBe(400);
    }
    const limited = await request(app).post("/api/auth/register").set("Origin", ORIGIN).set("X-Forwarded-For", "198.51.100.2").send({ email: "bad", password: "short" });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("allows only listed origins and echoes the matched origin on preflight", async () => {
    const app = createApp({ repository: new MemoryRepository(), frontendOrigins: [ORIGIN, "http://localhost:5173"] });
    const localhost = await request(app).post("/api/auth/login").set("Origin", "http://localhost:5173").send({ email: "missing@example.test", password: PASSWORD });
    expect(localhost.status).toBe(401);
    expect(localhost.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const foreign = await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:4100").send({ email: "missing@example.test", password: PASSWORD });
    expect(foreign.status).toBe(403);
    const preflight = await request(app).options("/api/auth/login").set("Origin", "http://localhost:5173");
    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(preflight.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("bounds health checks when the database does not answer", async () => {
    const repository = new MemoryRepository();
    repository.ping = async () => new Promise<void>(() => {});
    const app = createApp({ repository, frontendOrigins: [ORIGIN], healthTimeoutMs: 50 });
    const started = Date.now();
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "degraded", database: "unavailable" });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("returns JSON for unsupported bodies and unmatched API routes", async () => {
    const app = createApp({ repository: new MemoryRepository(), frontendOrigins: [ORIGIN] });
    const charset = await request(app).post("/api/auth/logout").set("Origin", ORIGIN).set("Content-Type", "application/json; charset=latin1").send("{}");
    expect(charset.status).toBe(415);
    expect(charset.body.error.code).toBe("unsupported_media_type");
    const encoding = await request(app).post("/api/auth/logout").set("Origin", ORIGIN).set("Content-Type", "application/json").set("Content-Encoding", "x-unknown").send("{}");
    expect(encoding.status).toBe(415);
    expect(encoding.body.error.code).toBe("unsupported_media_type");
    const missing = await request(app).get("/api/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
    expect(missing.headers["content-type"]).toMatch(/application\/json/);
  });

  it("logs only closed fields when persistence throws", async () => {
    const repository = new MemoryRepository();
    repository.createUser = async () => {
      throw Object.assign(new Error("params: synthetic@example.test,scrypt$16384$x"), { cause: { code: "23503" } });
    };
    const lines: string[] = [];
    const app = createApp({ repository, frontendOrigins: [ORIGIN], logger: createLogger((line) => lines.push(line)) });
    const response = await request(app).post("/api/auth/register").set("Origin", ORIGIN).send({ email: "synthetic@example.test", password: PASSWORD });
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("internal_error");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(lines.some((line) => JSON.parse(line).event === "internal_error" && JSON.parse(line).pgCode === "23503")).toBe(true);
    expect(lines.join("")).not.toMatch(/synthetic@example\.test|scrypt\$|aegislab_session=|correct horse battery staple/);
  });
});
