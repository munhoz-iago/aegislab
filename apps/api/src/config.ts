export interface ApiConfig {
  frontendOrigin: string;
  databaseUrl: string;
  host: string;
  port: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const origin = new URL(env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173");
  if (!(["http:", "https:"].includes(origin.protocol)) || origin.origin !== origin.href.replace(/\/$/, "")) {
    throw new Error("FRONTEND_ORIGIN must be an http(s) origin without a path");
  }

  const port = Number(env.PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be 1–65535");

  return {
    frontendOrigin: origin.origin,
    databaseUrl,
    host: env.HOST ?? "127.0.0.1",
    port,
  };
}
