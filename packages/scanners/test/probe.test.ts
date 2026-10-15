import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_ACK,
  ProbeConfigError,
  parseProbeConfig,
  runProbe,
  type ProbeConfig,
  type ProbeTransport,
} from "../src/index.js";

const localEnv = {
  AEGISLAB_AUTHORIZATION_ACK: AUTHORIZATION_ACK,
  AEGISLAB_AUTHORIZED_TARGET_ORIGIN: "http://127.0.0.1:4100",
};

function config(overrides: Partial<ProbeConfig> = {}): ProbeConfig {
  return { ...parseProbeConfig(localEnv), ...overrides };
}

describe("worker scope and resource limits", () => {
  it("requires affirmative authorization and an exact local origin", () => {
    expect(() => parseProbeConfig({ AEGISLAB_AUTHORIZED_TARGET_ORIGIN: localEnv.AEGISLAB_AUTHORIZED_TARGET_ORIGIN })).toThrow(ProbeConfigError);
    expect(() => parseProbeConfig({ AEGISLAB_AUTHORIZATION_ACK: AUTHORIZATION_ACK })).toThrow();

    for (const origin of [
      "https://example.com",
      "http://example.com:4100",
      "http://127.0.0.1:9999",
      "http://127.0.0.1:4100/other",
      "http://user:pass@127.0.0.1:4100",
      "http://demo-target.evil.test:4100",
      "http://localhost:4100",
      "http://[::1]:4100",
      "http://demo-target:4100",
    ]) {
      expect(() => parseProbeConfig({ ...localEnv, AEGISLAB_AUTHORIZED_TARGET_ORIGIN: origin })).toThrow();
    }
    expect(parseProbeConfig({
      ...localEnv,
      AEGISLAB_IN_CONTAINER: "1",
      AEGISLAB_AUTHORIZED_TARGET_ORIGIN: "http://demo-target:4100",
    }).allowContainerTarget).toBe(true);
  });

  it("restricts request paths and hard caps all configurable limits", () => {
    expect(() => parseProbeConfig({ ...localEnv, AEGISLAB_TARGET_PATH: "/admin" })).toThrow();
    expect(() => parseProbeConfig({ ...localEnv, AEGISLAB_TARGET_PATH: "/health?next=https://example.com" })).toThrow();
    expect(() => parseProbeConfig({ ...localEnv, AEGISLAB_MAX_CALLS: "11" })).toThrow();
    expect(() => parseProbeConfig({ ...localEnv, AEGISLAB_REQUEST_TIMEOUT_MS: "2001" })).toThrow();
    expect(() => parseProbeConfig({ ...localEnv, AEGISLAB_TOTAL_DURATION_MS: "10001" })).toThrow();
    expect(() => parseProbeConfig({ ...localEnv, AEGISLAB_MAX_CALLS: "1.5" })).toThrow();
    expect(() => parseProbeConfig({ ...localEnv, AEGISLAB_MAX_CALLS: "-1" })).toThrow();
  });

  it("uses sequential GET requests, cancels bodies, and never follows redirects", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    let activeBodies = 0;
    let cancelledBodies = 0;
    const transport: ProbeTransport = async (url, init) => {
      expect(activeBodies).toBe(0);
      expect(url.href).toBe("http://127.0.0.1:4100/health");
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("manual");
      expect(init.credentials).toBe("omit");
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      activeBodies += 1;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("sensitive body must not be logged"));
        },
        cancel() {
          activeBodies -= 1;
          cancelledBodies += 1;
        },
      });
      return new Response(body, { status: 302 });
    };

    const result = await runProbe(config({ maxCalls: 3 }), transport);

    expect(result.attemptedCalls).toBe(3);
    expect(result).toMatchObject({ kind: "availability_probe", notABenchmark: true, measures: "wall time until response headers plus body cancel" });
    expect(result.observations.map((item) => item.warmup)).toEqual([true, false, false]);
    expect(peakInFlight).toBe(1);
    expect(result.observations.every((item) => item.status === 302)).toBe(true);
    expect(cancelledBodies).toBe(3);
    expect(activeBodies).toBe(0);
    expect(JSON.stringify(result)).not.toContain("sensitive body");
  });

  it("stops if a response body cannot be canceled", async () => {
    let calls = 0;
    const transport: ProbeTransport = async () => {
      calls += 1;
      return new Response(new ReadableStream({
        cancel() {
          throw new Error("cleanup failed");
        },
      }), { status: 200 });
    };

    const result = await runProbe(config({ maxCalls: 3 }), transport);

    expect(calls).toBe(1);
    expect(result.observations[0]).toMatchObject({ outcome: "cleanup_error", status: 200 });
  });

  it("bounds a stalled body cancellation and starts no further request", async () => {
    let calls = 0;
    const transport: ProbeTransport = async () => {
      calls += 1;
      return new Response(new ReadableStream({
        cancel() {
          return new Promise<void>(() => undefined);
        },
      }), { status: 200 });
    };
    const started = Date.now();

    const result = await runProbe(
      config({ maxCalls: 3, requestTimeoutMs: 100, totalDurationMs: 1_000 }),
      transport,
    );

    expect(calls).toBe(1);
    expect(result.observations[0]).toMatchObject({ outcome: "timeout", status: 200 });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("stops after a timeout even if transport ignores abort", async () => {
    const transport: ProbeTransport = async () => new Promise<Response>(() => undefined);
    const started = Date.now();

    const result = await runProbe(
      config({ maxCalls: 10, requestTimeoutMs: 100, totalDurationMs: 1_000 }),
      transport,
    );

    expect(result.attemptedCalls).toBe(1);
    expect(result.observations[0]?.outcome).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("applies the total duration cap across repeated successful calls", async () => {
    const transport: ProbeTransport = async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return new Response(null, { status: 200 });
    };

    const result = await runProbe(
      config({ maxCalls: 10, requestTimeoutMs: 2_000, totalDurationMs: 100 }),
      transport,
    );

    expect(result.attemptedCalls).toBeLessThanOrEqual(2);
    expect(result.observations[0]?.status).toBe(200);
  });

  it("rejects unsafe direct calls that bypass environment parsing", async () => {
    await expect(runProbe(config({ authorizationAck: "" }))).rejects.toThrow();
    await expect(runProbe(config({ origin: "http://example.com" }))).rejects.toThrow();
    await expect(runProbe(config({ maxCalls: 999 }))).rejects.toThrow();
  });

  it("does not follow a redirect with the real fetch transport", async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? "");
      response.writeHead(302, { Location: "/elsewhere" }).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    try {
      const result = await runProbe(config({ maxCalls: 1 }), (url, init) =>
        fetch(new URL(url.pathname, `http://127.0.0.1:${address.port}`), init));
      expect(result.observations[0]).toMatchObject({ outcome: "http", status: 302 });
      expect(paths).toEqual(["/health"]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
