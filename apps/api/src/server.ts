import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.js";
import { startSessionCleanup } from "./auth/session-cleanup.js";
import { createPostgresRepository } from "./db/postgres-repository.js";
import { createApp } from "./http/app.js";
import { createShutdown, startServer } from "./http/server-lifecycle.js";
import { createLogger, errorFields } from "./observability/log.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const config = readConfig();
const logger = createLogger();
const { repository, pool } = createPostgresRepository(config.databaseUrl, logger);
const app = createApp({ repository, frontendOrigins: config.frontendOrigins, logger });
let server;
try {
  server = await startServer(app, { host: config.host, port: config.port });
} catch (error) {
  const code = errorFields(error).pgCode ?? "UNKNOWN";
  process.stderr.write(`AegisLab API failed to listen on ${config.host}:${config.port} (${code})\n`);
  await pool.end();
  process.exitCode = 1;
}

if (server) {
  logger.event("api_listening", { level: "info" });
  const stopCleanup = startSessionCleanup(repository, logger);
  const shutdown = createShutdown({ server, pool, logger, onStop: stopCleanup });
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
