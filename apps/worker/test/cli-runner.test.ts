import { AUTHORIZATION_ACK, type ProbeTransport } from "@aegislab/scanners";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli-runner.js";

function outputBuffer() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, output: { stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value) } };
}

describe("worker CLI orchestration", () => {
  it("rejects missing authorization without echoing untrusted input", async () => {
    const buffer = outputBuffer();
    const result = await runCli(
      { AEGISLAB_AUTHORIZED_TARGET_ORIGIN: "http://unsafe.example/secret" },
      buffer.output,
    );

    expect(result).toBe(1);
    expect(buffer.stdout).toEqual([]);
    expect(buffer.stderr).toEqual([
      "Probe rejected: Explicit local-target authorization acknowledgment is required\n",
    ]);
  });

  it("prints only the bounded scanner summary", async () => {
    const buffer = outputBuffer();
    const response = new Response("sensitive body", { status: 200 });
    const transport: ProbeTransport = async () => response;
    const result = await runCli(
      {
        AEGISLAB_AUTHORIZATION_ACK: AUTHORIZATION_ACK,
        AEGISLAB_AUTHORIZED_TARGET_ORIGIN: "http://127.0.0.1:4100",
        AEGISLAB_MAX_CALLS: "1",
      },
      buffer.output,
      transport,
    );

    expect(result).toBe(0);
    expect(buffer.stderr).toEqual([]);
    expect(buffer.stdout).toHaveLength(1);
    expect(JSON.parse(buffer.stdout[0] ?? "{}").attemptedCalls).toBe(1);
    expect(buffer.stdout[0]).not.toContain("sensitive body");
    expect(response.bodyUsed).toBe(true);
  });

  it("distinguishes a failed availability probe from rejected scope", async () => {
    const env = {
      AEGISLAB_AUTHORIZATION_ACK: AUTHORIZATION_ACK,
      AEGISLAB_AUTHORIZED_TARGET_ORIGIN: "http://127.0.0.1:4100",
      AEGISLAB_MAX_CALLS: "1",
    };
    const degraded = outputBuffer();
    expect(await runCli(env, degraded.output, async () => new Response(null, { status: 503 }))).toBe(2);
    expect(JSON.parse(degraded.stdout[0] ?? "{}").observations[0].status).toBe(503);
    const rejected = outputBuffer();
    expect(await runCli({ ...env, AEGISLAB_MAX_CALLS: "11" }, rejected.output)).toBe(1);
    expect(rejected.stdout).toEqual([]);
    expect(rejected.stderr.join(" ")).toContain("AEGISLAB_MAX_CALLS");
  });
});
