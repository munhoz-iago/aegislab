import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.js";
import { createPostgresRepository } from "./db/postgres-repository.js";
import { createApp } from "./http/app.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const config = readConfig();
const { repository, pool } = createPostgresRepository(config.databaseUrl);
const app = createApp({ repository, frontendOrigin: config.frontendOrigin });
const server = app.listen(config.port, config.host, () => {
  process.stdout.write(`AegisLab API listening on ${config.host}:${config.port}\n`);
});

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
