import { createServer, type Server } from "node:http";
import { createDemoTargetApp } from "./app.js";

export function resolveHost(env: NodeJS.ProcessEnv): string {
  const host = env.DEMO_TARGET_HOST?.trim() || "127.0.0.1";
  if (host === "127.0.0.1" || (host === "0.0.0.0" && env.AEGISLAB_IN_CONTAINER === "1")) return host;
  throw new Error("DEMO_TARGET_HOST must be 127.0.0.1 (0.0.0.0 only with AEGISLAB_IN_CONTAINER=1)");
}

export function startDemoTarget({ host, port = 4100 }: { host: string; port?: number }): Promise<Server> {
  const server = createServer(createDemoTargetApp());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

export function createShutdown(server: Server): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  return () => {
    stopping ??= new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    return stopping;
  };
}
