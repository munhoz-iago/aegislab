import { parseProbeConfig, ProbeConfigError, runProbe, type ProbeTransport } from "@aegislab/scanners";

export interface CliOutput {
  stdout(message: string): void;
  stderr(message: string): void;
}

/** Thin adapter; all scope checks and network limits live in scanners. */
export async function runCli(
  env: NodeJS.ProcessEnv,
  output: CliOutput,
  transport?: ProbeTransport,
): Promise<number> {
  try {
    const config = parseProbeConfig(env);
    const summary = await runProbe(config, transport);
    output.stdout(`${JSON.stringify(summary)}\n`);
    return summary.observations.length > 0 && summary.observations.every(
      (observation) => observation.outcome === "http" && observation.status !== null && observation.status >= 200 && observation.status < 400,
    ) ? 0 : 2;
  } catch (error) {
    if (error instanceof ProbeConfigError) {
      output.stderr(`Probe rejected: ${error.message}\n`);
      return 1;
    }
    // Never echo untrusted configuration, transport errors, or response content.
    output.stderr("Probe rejected or failed. Check local authorization and scope settings.\n");
    return 1;
  }
}
