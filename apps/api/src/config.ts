export interface ApiConfig {
  frontendOrigins: string[];
  databaseUrl: string;
  host: string;
  port: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const originInput = env.FRONTEND_ORIGIN?.trim() || "http://127.0.0.1:5173,http://localhost:5173";
  const entries = originInput.split(",").map((value) => value.trim());
  if (entries.length < 1 || entries.length > 4 || entries.some((value) => !value)) {
    throw new Error("FRONTEND_ORIGIN must contain 1–4 http(s) origins without paths");
  }
  const frontendOrigins = entries.map((entry) => {
    try {
      const origin = new URL(entry);
      if (!["http:", "https:"].includes(origin.protocol) || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) {
        throw new Error("invalid origin");
      }
      return origin.origin;
    } catch {
      throw new Error("FRONTEND_ORIGIN must contain 1–4 http(s) origins without paths");
    }
  });

  const portInput = env.PORT?.trim() || "3001";
  if (!/^\d+$/.test(portInput)) throw new Error("PORT must be a decimal number from 1 to 65535");
  const port = Number(portInput);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a decimal number from 1 to 65535");

  const host = env.API_HOST?.trim() || "127.0.0.1";
  if (!(host === "127.0.0.1" || host === "::1" || (host === "0.0.0.0" && env.AEGISLAB_IN_CONTAINER === "1"))) {
    throw new Error("API_HOST must be 127.0.0.1 or ::1 (0.0.0.0 only with AEGISLAB_IN_CONTAINER=1)");
  }

  return {
    frontendOrigins: [...new Set(frontendOrigins)],
    databaseUrl,
    host,
    port,
  };
}
