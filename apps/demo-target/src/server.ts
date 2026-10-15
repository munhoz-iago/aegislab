import { createShutdown, resolveHost, startDemoTarget } from "./start.js";

const host = resolveHost(process.env);
try {
  const server = await startDemoTarget({ host });
  process.stdout.write(`Demo target listening on ${host}:4100\n`);
  const shutdown = createShutdown(server);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void shutdown().catch(() => { process.exitCode = 1; });
    });
  }
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "unknown";
  process.stderr.write(`Demo target failed to listen on ${host}:4100 (${code})\n`);
  process.exitCode = 1;
}
