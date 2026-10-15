import type { AuthRepository } from "./repository.js";
import { errorFields, noopLogger, type Logger } from "../observability/log.js";

const BATCH_SIZE = 100;
const MAX_BATCHES = 10;
const INTERVAL_MS = 15 * 60 * 1000;

export async function sweepExpiredSessions(repository: Pick<AuthRepository, "deleteExpiredSessions">, now = new Date()): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const deleted = await repository.deleteExpiredSessions(now);
    total += deleted;
    if (deleted < BATCH_SIZE) break;
  }
  return total;
}

export function startSessionCleanup(repository: Pick<AuthRepository, "deleteExpiredSessions">, logger: Logger = noopLogger): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const count = await sweepExpiredSessions(repository);
      logger.event("session_purge", { level: "info", count });
    } catch (error) {
      logger.event("session_purge_failed", { level: "warn", ...errorFields(error) });
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
