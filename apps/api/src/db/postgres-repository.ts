import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DuplicateEmailError, type AuthRepository, type PublicUser, type StoredUser } from "../auth/repository.js";
import { sessions, users } from "./schema.js";
import { errorFields, noopLogger, type Logger } from "../observability/log.js";

export function createPostgresRepository(connectionString: string, logger: Logger = noopLogger): { repository: AuthRepository; pool: Pool } {
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 3_000, idleTimeoutMillis: 10_000, query_timeout: 5_000, statement_timeout: 5_000 });
  pool.on("error", (error) => {
    // pg-pool removes broken idle clients. The message may include query parameters.
    logger.event("pg_idle_client_error", { level: "warn", ...errorFields(error) });
  });
  const db = drizzle(pool);

  const repository: AuthRepository = {
    async ping() {
      await pool.query("select 1");
    },
    async findUserByEmail(email) {
      const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return (row as StoredUser | undefined) ?? null;
    },
    async findUserBySession(tokenHash, now) {
      const [row] = await db
        .select({ id: users.id, email: users.email, createdAt: users.createdAt })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
        .limit(1);
      return (row as PublicUser | undefined) ?? null;
    },
    async createUser(email, passwordHash) {
      try {
        const [row] = await db.insert(users).values({ email, passwordHash }).returning();
        if (!row) throw new Error("User insert returned no row");
        return row;
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateEmailError();
        throw error;
      }
    },
    async createSession(userId, tokenHash, expiresAt) {
      await db.insert(sessions).values({ userId, tokenHash, expiresAt });
    },
    async deleteSession(tokenHash) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
    async deleteExpiredSessions(now) {
      const due = await db
        .select({ tokenHash: sessions.tokenHash })
        .from(sessions)
        .where(lte(sessions.expiresAt, now))
        .orderBy(sessions.expiresAt)
        .limit(100);
      if (due.length === 0) return 0;
      const deleted = await db.delete(sessions)
        .where(inArray(sessions.tokenHash, due.map((row) => row.tokenHash)))
        .returning({ tokenHash: sessions.tokenHash });
      return deleted.length;
    },
  };

  return { repository, pool };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : undefined;
  const cause = "cause" in error ? error.cause : undefined;
  return code === "23505" || (cause !== error && isUniqueViolation(cause));
}
