import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type Express, type Request, type RequestHandler, type Response } from "express";
import { DuplicateEmailError, type AuthRepository, type PublicUser } from "../auth/repository.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  createSessionToken,
  hashSessionToken,
  readSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_LIFETIME_MS,
} from "../auth/session.js";
import { databaseUnavailableReason } from "../db/availability.js";
import { errorFields, noopLogger, type Logger } from "../observability/log.js";
import { makeRateLimiter } from "./rate-limit.js";

/** Above the 3 s pool connection timeout, so a retrying client does not stack waiting requests. */
const DATABASE_RETRY_AFTER_SECONDS = 5;

export interface AppOptions {
  repository: AuthRepository;
  frontendOrigins: readonly string[];
  logger?: Logger;
  now?: () => number;
  healthTimeoutMs?: number;
}

export function createApp({ repository, frontendOrigins, logger = noopLogger, now, healthTimeoutMs = 1_000 }: AppOptions): Express {
  const app = express();
  const allowedOrigins = new Set(frontendOrigins);

  app.disable("x-powered-by");
  app.disable("trust proxy");
  app.use((req, res, next) => {
    const requestId = randomUUID();
    const started = process.hrtime.bigint();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    res.on("finish", () => {
      logger.event("http_request", {
        level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
        requestId,
        method: req.method,
        route: typeof req.route?.path === "string" ? req.route.path : "unmatched",
        status: res.statusCode,
        durationMs: Math.round(Number(process.hrtime.bigint() - started) / 10_000) / 100,
      });
    });
    next();
  });
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.vary("Origin");
    const origin = req.get("origin");
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      if (!origin || !allowedOrigins.has(origin)) {
        logger.event("origin_forbidden", { level: "warn", requestId: res.locals.requestId });
        return sendError(res, 403, "origin_forbidden", "Origin is not allowed");
      }
      return res.sendStatus(204);
    }
    if (req.method === "POST" && (!origin || !allowedOrigins.has(origin))) {
      logger.event("origin_forbidden", { level: "warn", requestId: res.locals.requestId });
      return sendError(res, 403, "origin_forbidden", "Origin is not allowed");
    }
    next();
  });
  app.use(express.json({ limit: "16kb", strict: true }));

  const onLimited: RequestHandler = (req, res) => logger.event("rate_limited", {
    level: "warn", requestId: res.locals.requestId, route: req.route?.path,
  });
  const registerLimit = makeRateLimiter(5, { now, onLimited });
  const loginLimit = makeRateLimiter(10, { now, onLimited });

  app.get(
    "/api/health",
    asyncRoute(async (_req, res) => {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            repository.ping(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error("health_timeout")), healthTimeoutMs);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        res.json({ status: "ok", database: "connected" });
      } catch {
        res.status(503).json({ status: "degraded", database: "unavailable" });
      }
    }),
  );

  app.post(
    "/api/auth/register",
    registerLimit,
    asyncRoute(async (req, res) => {
      const credentials = parseCredentials(req.body);
      if (!credentials) {
        logger.event("auth_failed", { level: "warn", requestId: res.locals.requestId, reason: "validation_error" });
        return sendError(res, 400, "validation_error", "Valid email and 12–128 character password required");
      }

      const passwordHash = await hashPassword(credentials.password);
      let user: PublicUser;
      try {
        user = await repository.createUser(credentials.email, passwordHash);
      } catch (error) {
        if (error instanceof DuplicateEmailError) return sendError(res, 409, "email_in_use", "Email is already registered");
        throw error;
      }
      await issueSession(res, repository, user.id, req.get("origin")!.startsWith("https:"));
      logger.event("auth_succeeded", { level: "info", requestId: res.locals.requestId, route: "/api/auth/register" });
      res.status(201).json({ user: publicUser(user) });
    }),
  );

  app.post(
    "/api/auth/login",
    loginLimit,
    asyncRoute(async (req, res) => {
      const credentials = parseCredentials(req.body);
      if (!credentials) {
        logger.event("auth_failed", { level: "warn", requestId: res.locals.requestId, reason: "validation_error" });
        return sendError(res, 400, "validation_error", "Valid email and 12–128 character password required");
      }

      const user = await repository.findUserByEmail(credentials.email);
      if (!user) {
        // Run the same bounded KDF work as a failed password check.
        await hashPassword(credentials.password);
        logger.event("auth_failed", { level: "warn", requestId: res.locals.requestId, reason: "invalid_credentials" });
        return sendError(res, 401, "invalid_credentials", "Invalid email or password");
      }
      if (!(await verifyPassword(credentials.password, user.passwordHash))) {
        logger.event("auth_failed", { level: "warn", requestId: res.locals.requestId, reason: "invalid_credentials" });
        return sendError(res, 401, "invalid_credentials", "Invalid email or password");
      }

      await issueSession(res, repository, user.id, req.get("origin")!.startsWith("https:"));
      logger.event("auth_succeeded", { level: "info", requestId: res.locals.requestId, route: "/api/auth/login" });
      res.json({ user: publicUser(user) });
    }),
  );

  app.post(
    "/api/auth/logout",
    asyncRoute(async (req, res) => {
      const token = readSessionToken(req.get("cookie"));
      if (token) await repository.deleteSession(hashSessionToken(token));
      res.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, sameSite: "strict", secure: req.get("origin")!.startsWith("https:"), path: "/api" });
      res.status(204).end();
    }),
  );

  const authenticate: RequestHandler = asyncRoute(async (req, res, next) => {
    const token = readSessionToken(req.get("cookie"));
    if (!token) return sendError(res, 401, "unauthorized", "Authentication required");
    const user = await repository.findUserBySession(hashSessionToken(token), new Date());
    if (!user) return sendError(res, 401, "unauthorized", "Authentication required");
    res.locals.user = user;
    next();
  });

  app.get("/api/auth/me", authenticate, (_req, res) => {
    res.json({ user: publicUser(res.locals.user as PublicUser) });
  });

  app.get("/api/dashboard", authenticate, (_req, res) => {
    res.json({
      status: "foundation",
      modules: [
        { id: "demo", label: "Aplicação de demonstração segura", status: "available" },
        { id: "security", label: "Engenharia de segurança", status: "planned" },
        { id: "performance", label: "Engenharia de performance", status: "planned" },
        { id: "observability", label: "Observabilidade", status: "planned" },
      ],
      note: "Foundation em execução. Nenhuma medição ou varredura foi realizada por este dashboard.",
    });
  });

  app.use("/api", (_req, res) => sendError(res, 404, "not_found", "Route not found"));

  app.use(((error: unknown, _req: Request, res: Response, next: (error?: unknown) => void) => {
    if (res.headersSent) return next(error);
    if (isBodyError(error, "entity.too.large")) return sendError(res, 413, "payload_too_large", "JSON body exceeds 16 KB");
    if (isBodyError(error, "entity.parse.failed")) return sendError(res, 400, "invalid_json", "Invalid JSON body");
    const status = bodyErrorStatus(error);
    if (status === 415) return sendError(res, 415, "unsupported_media_type", "Unsupported request body encoding");
    if (status && status >= 400 && status < 500) return sendError(res, status, "bad_request", "Invalid request body");
    const unavailable = databaseUnavailableReason(error);
    if (unavailable) {
      logger.event("database_unavailable", { level: "error", requestId: res.locals.requestId, reason: unavailable, ...errorFields(error) });
      res.setHeader("Retry-After", String(DATABASE_RETRY_AFTER_SECONDS));
      return sendError(res, 503, "database_unavailable", "Database is temporarily unavailable");
    }
    logger.event("internal_error", { level: "error", requestId: res.locals.requestId, ...errorFields(error) });
    return sendError(res, 500, "internal_error", "Internal server error");
  }) as ErrorRequestHandler);

  return app;
}

type Route = (req: Request, res: Response, next: () => void) => Promise<unknown>;

function asyncRoute(route: Route): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(route(req, res, next)).catch(next);
  };
}

function parseCredentials(body: unknown): { email: string; password: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") return null;
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length < 3 || normalizedEmail.length > 254) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(normalizedEmail)) return null;
  if (password.length < 12 || password.length > 128) return null;
  return { email: normalizedEmail, password };
}

async function issueSession(res: Response, repository: AuthRepository, userId: string, secureCookie: boolean): Promise<void> {
  const token = createSessionToken();
  await repository.createSession(userId, hashSessionToken(token), new Date(Date.now() + SESSION_LIFETIME_MS));
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookie,
    path: "/api",
    maxAge: SESSION_LIFETIME_MS,
  });
}

function publicUser(user: PublicUser): { id: string; email: string; createdAt: string } {
  return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function isBodyError(error: unknown, type: string): boolean {
  return Boolean(error && typeof error === "object" && "type" in error && error.type === type);
}

function bodyErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  if (!("expose" in error) || error.expose !== true) return null;
  const status = "status" in error ? error.status : undefined;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}
