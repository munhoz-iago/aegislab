import { performance } from "node:perf_hooks";
import { assertProbeConfig, type ProbeConfig } from "./config.js";

export type ProbeTransport = (url: URL, init: RequestInit) => Promise<Response>;

export interface ProbeObservation {
  outcome: "http" | "timeout" | "network_error" | "cleanup_error";
  status: number | null;
  elapsedMs: number;
  warmup: boolean;
}

export interface ProbeSummary {
  kind: "availability_probe";
  notABenchmark: true;
  measures: "wall time until response headers plus body cancel";
  startedAt: string;
  runtime: string;
  limits: Pick<ProbeConfig, "maxCalls" | "requestTimeoutMs" | "totalDurationMs">;
  target: string;
  attemptedCalls: number;
  elapsedMs: number;
  observations: ProbeObservation[];
}

const defaultTransport: ProbeTransport = (url, init) => fetch(url, init);
const elapsed = (start: number, end: number): number => Math.round((end - start) * 100) / 100;

export interface ProbeClock {
  now(): number;
  wallNow(): Date;
}

const defaultClock: ProbeClock = { now: () => performance.now(), wallNow: () => new Date() };

/**
 * Performs only sequential GET requests. Redirects are never followed, and
 * response bodies or headers are never read or recorded. Each body is canceled
 * before another request starts.
 */
export async function runProbe(
  config: ProbeConfig,
  transport: ProbeTransport = defaultTransport,
  clock: ProbeClock = defaultClock,
): Promise<ProbeSummary> {
  // Revalidate at the last boundary, even if a caller bypasses environment parsing.
  assertProbeConfig(config);

  const target = new URL(config.path, `${config.origin}/`);
  const started = clock.now();
  const startedAt = clock.wallNow().toISOString();
  const observations: ProbeObservation[] = [];

  for (let call = 0; call < config.maxCalls; call += 1) {
    const remainingMs = config.totalDurationMs - (clock.now() - started);
    if (remainingMs <= 0) break;

    const requestStarted = clock.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = Math.max(1, Math.floor(Math.min(config.requestTimeoutMs, remainingMs)));
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("request_timeout"));
      }, timeoutMs);
    });

    try {
      const response = await Promise.race([
        transport(target, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          headers: { accept: "application/json" },
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);

      let outcome: ProbeObservation["outcome"] = "http";
      if (response.body) {
        try {
          // Cancel without reading. The same request deadline also bounds cleanup.
          await Promise.race([response.body.cancel(), timeoutPromise]);
        } catch {
          outcome = controller.signal.aborted ? "timeout" : "cleanup_error";
        }
      }
      if (timer) clearTimeout(timer);
      timer = undefined;
      controller.abort();

      observations.push({
        outcome,
        status: response.status,
        elapsedMs: elapsed(requestStarted, clock.now()),
        warmup: call === 0,
      });
      // Failed cleanup could leave a body active; never start another request.
      if (outcome !== "http") break;
    } catch {
      const timedOut = controller.signal.aborted;
      observations.push({
        outcome: timedOut ? "timeout" : "network_error",
        status: null,
        elapsedMs: elapsed(requestStarted, clock.now()),
        warmup: call === 0,
      });
      // A transport that ignores abort may still be in flight; never overlap it.
      if (timedOut) break;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    kind: "availability_probe",
    notABenchmark: true,
    measures: "wall time until response headers plus body cancel",
    startedAt,
    runtime: process.version,
    limits: { maxCalls: config.maxCalls, requestTimeoutMs: config.requestTimeoutMs, totalDurationMs: config.totalDurationMs },
    target: target.href,
    attemptedCalls: observations.length,
    elapsedMs: elapsed(started, clock.now()),
    observations,
  };
}
