import { createServer, type Server } from "node:http";
import type { Express } from "express";
import { errorFields, noopLogger, type Logger } from "../observability/log.js";

export async function startServer(app: Express, { host, port }: { host: string; port: number }): Promise<Server> {
  const server = createServer(app);
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  return new Promise<Server>((resolve, reject) => {
    const onListening = () => {
      server.off("error", onError);
      resolve(server);
    };
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(port, host);
  });
}

export interface ShutdownOptions {
  server: Server;
  pool: { end(): Promise<unknown> };
  logger?: Logger;
  graceMs?: number;
  exit?: (code: number) => void;
  onStop?: () => void;
}

export function createShutdown({ server, pool, logger = noopLogger, graceMs = 8_000, exit = (code) => process.exit(code), onStop }: ShutdownOptions): (signal: string) => Promise<void> {
  let stopping = false;
  return async (signal) => {
    if (stopping) {
      logger.event("shutdown_forced", { level: "warn", reason: signal });
      exit(1);
      return;
    }
    stopping = true;
    const started = process.hrtime.bigint();
    logger.event("shutdown_started", { level: "info", reason: signal });
    try {
      onStop?.();
      server.closeIdleConnections();
    } catch (error) {
      logger.event("shutdown_error", { level: "error", ...errorFields(error) });
      process.exitCode = 1;
    }
    const timer = setTimeout(() => {
      server.closeAllConnections();
      exit(1);
    }, graceMs);
    timer.unref();
    // A connection can turn idle only after an in-flight response completes.
    const idleSweep = setInterval(() => server.closeIdleConnections(), 50);
    idleSweep.unref();
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      await pool.end();
    } catch (error) {
      logger.event("shutdown_error", { level: "error", ...errorFields(error) });
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
      clearInterval(idleSweep);
      logger.event("shutdown_complete", {
        level: "info",
        durationMs: Math.round(Number(process.hrtime.bigint() - started) / 10_000) / 100,
      });
    }
  };
}
