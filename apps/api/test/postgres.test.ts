import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { createPostgresRepository } from "../src/db/postgres-repository.js";
import type { AuthRepository } from "../src/auth/repository.js";
import { createApp } from "../src/http/app.js";

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("PostgreSQL repository integration", () => {
  let pool: Pool;
  let repository: AuthRepository;
  let migrated = false;
  const email = `foundation-${randomBytes(8).toString("hex")}@example.test`;
  const httpEmail = `http-${randomBytes(8).toString("hex")}@example.test`;
  const cleanupEmail = `cleanup-${randomBytes(8).toString("hex")}@example.test`;

  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) || !url.pathname.endsWith("_test")) {
      throw new Error("TEST_DATABASE_URL must target a loopback *_test database");
    }
    ({ pool, repository } = createPostgresRepository(testUrl!));
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    migrated = true;
  });

  afterAll(async () => {
    if (pool) {
      try {
        if (migrated) await pool.query("delete from users where email = any($1::text[])", [[email, httpEmail, cleanupEmail]]);
      } finally {
        await pool.end();
      }
    }
  });

  it("persists users and hashed sessions across repository reads", async () => {
    await repository.ping();
    const user = await repository.createUser(email, await hashPassword("a synthetic test password"));
    expect(user.email).toBe(email);
    expect((await repository.findUserByEmail(email))?.id).toBe(user.id);

    const tokenHash = randomBytes(32).toString("hex");
    await repository.createSession(user.id, tokenHash, new Date(Date.now() + 60_000));
    expect((await repository.findUserBySession(tokenHash, new Date()))?.id).toBe(user.id);
    expect(await repository.findUserBySession(tokenHash, new Date(Date.now() + 120_000))).toBeNull();
    await repository.deleteSession(tokenHash);
    expect(await repository.findUserBySession(tokenHash, new Date())).toBeNull();
    await expect(repository.deleteSession(tokenHash)).resolves.toBeUndefined();
  });

  it("deletes expired sessions in bounded batches and preserves live sessions", async () => {
    const user = await repository.createUser(cleanupEmail, await hashPassword("synthetic cleanup password"));
    const expired = Array.from({ length: 105 }, () => randomBytes(32).toString("hex"));
    const live = randomBytes(32).toString("hex");
    for (const tokenHash of expired) {
      await repository.createSession(user.id, tokenHash, new Date(0));
    }
    await repository.createSession(user.id, live, new Date(Date.now() + 60_000));

    expect(await repository.findUserBySession(expired[0]!, new Date(0))).toBeNull();

    expect(await repository.deleteExpiredSessions(new Date(0))).toBe(100);
    expect(await repository.deleteExpiredSessions(new Date(0))).toBe(5);
    expect(await repository.deleteExpiredSessions(new Date(0))).toBe(0);
    const remaining = await pool.query<{ token_hash: string }>("select token_hash from sessions where user_id = $1", [user.id]);
    expect(remaining.rows.map((row) => row.token_hash)).toEqual([live]);
  });

  it("serves registration and dashboard through the real PostgreSQL repository", async () => {
    const origin = "http://127.0.0.1:5173";
    const browser = request.agent(createApp({ repository, frontendOrigins: [origin] }));
    const registered = await browser.post("/api/auth/register").set("Origin", origin).send({ email: httpEmail, password: "synthetic integration password" });
    expect(registered.status).toBe(201);
    expect(registered.body.user.email).toBe(httpEmail);
    const duplicate = await browser.post("/api/auth/register").set("Origin", origin).send({ email: httpEmail, password: "synthetic integration password" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("email_in_use");
    const dashboard = await browser.get("/api/dashboard");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.status).toBe("foundation");
    expect((await browser.post("/api/auth/logout").set("Origin", origin)).status).toBe(204);
    expect((await browser.get("/api/auth/me")).status).toBe(401);
  });
});
