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

export interface AppOptions {
  repository: AuthRepository;
  frontendOrigin: string;
}

const WINDOW_MS = 10 * 60 * 1000;

export function createApp({ repository, frontendOrigin }: AppOptions): Express {
  const app = express();
  const secureCookie = new URL(frontendOrigin).protocol === "https:";

  app.disable("x-powered-by");
  app.disable("trust proxy");
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.vary("Origin");
    if (req.get("origin") === frontendOrigin) {
      res.setHeader("Access-Control-Allow-Origin", frontendOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      if (req.get("origin") !== frontendOrigin) {
        return sendError(res, 403, "origin_forbidden", "Origin is not allowed");
      }
      return res.sendStatus(204);
    }
    if (req.method === "POST" && req.get("origin") !== frontendOrigin) {
      return sendError(res, 403, "origin_forbidden", "Origin is not allowed");
    }
    next();
  });
  app.use(express.json({ limit: "16kb", strict: true }));

  const registerLimit = makeRateLimiter(5);
  const loginLimit = makeRateLimiter(10);

  app.get(
    "/api/health",
    asyncRoute(async (_req, res) => {
      try {
        await repository.ping();
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
      if (!credentials) return sendError(res, 400, "validation_error", "Valid email and 12–128 character password required");

      const passwordHash = await hashPassword(credentials.password);
      let user: PublicUser;
      try {
        user = await repository.createUser(credentials.email, passwordHash);
      } catch (error) {
        if (error instanceof DuplicateEmailError) return sendError(res, 409, "email_in_use", "Email is already registered");
        throw error;
      }
      await issueSession(res, repository, user.id, secureCookie);
      res.status(201).json({ user: publicUser(user) });
    }),
  );

  app.post(
    "/api/auth/login",
    loginLimit,
    asyncRoute(async (req, res) => {
      const credentials = parseCredentials(req.body);
      if (!credentials) return sendError(res, 400, "validation_error", "Valid email and 12–128 character password required");

      const user = await repository.findUserByEmail(credentials.email);
      if (!user) {
        // Run the same bounded KDF work as a failed password check.
        await hashPassword(credentials.password);
        return sendError(res, 401, "invalid_credentials", "Invalid email or password");
      }
      if (!(await verifyPassword(credentials.password, user.passwordHash))) {
        return sendError(res, 401, "invalid_credentials", "Invalid email or password");
      }

      await issueSession(res, repository, user.id, secureCookie);
      res.json({ user: publicUser(user) });
    }),
  );

  app.post(
    "/api/auth/logout",
    asyncRoute(async (req, res) => {
      const token = readSessionToken(req.get("cookie"));
      if (token) await repository.deleteSession(hashSessionToken(token));
      res.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, sameSite: "strict", secure: secureCookie, path: "/api" });
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

  app.use(((error: unknown, _req: Request, res: Response, _next: (error?: unknown) => void) => {
    if (res.headersSent) return;
    if (isBodyError(error, "entity.too.large")) return sendError(res, 413, "payload_too_large", "JSON body exceeds 16 KB");
    if (isBodyError(error, "entity.parse.failed")) return sendError(res, 400, "invalid_json", "Invalid JSON body");
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

function makeRateLimiter(limit: number): RequestHandler {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.resetAt <= now) attempts.delete(key);
    if (attempts.size >= 2_048) return sendError(res, 503, "rate_store_full", "Authentication temporarily unavailable");
    const key = req.socket.remoteAddress ?? "unknown";
    const entry = attempts.get(key) ?? { count: 0, resetAt: now + WINDOW_MS };
    entry.count += 1;
    attempts.set(key, entry);
    if (entry.count > limit) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1_000));
      return sendError(res, 429, "rate_limited", "Too many attempts; try again later");
    }
    next();
  };
}
