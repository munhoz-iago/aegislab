export const LOCAL_ORIGINS = ["http://127.0.0.1:4100"] as const;
export const CONTAINER_ORIGINS = ["http://demo-target:4100"] as const;

export const ALLOWED_PATHS = ["/health", "/api/synthetic-cases"] as const;

export const AUTHORIZATION_ACK = "I_OWN_THIS_LOCAL_TARGET";

export interface ProbeConfig {
  authorizationAck: string;
  allowContainerTarget: boolean;
  origin: string;
  path: string;
  maxCalls: number;
  requestTimeoutMs: number;
  totalDurationMs: number;
}

export class ProbeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeConfigError";
  }
}

const LIMITS = {
  maxCalls: { defaultValue: 3, min: 1, max: 10 },
  requestTimeoutMs: { defaultValue: 1_000, min: 100, max: 2_000 },
  totalDurationMs: { defaultValue: 3_000, min: 100, max: 10_000 },
} as const;

function boundedInteger(
  value: string | undefined,
  name: string,
  limit: { readonly defaultValue: number; readonly min: number; readonly max: number },
): number {
  if (value === undefined) return limit.defaultValue;
  if (!/^\d+$/.test(value)) throw new ProbeConfigError(`${name} must be an integer`);

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < limit.min || parsed > limit.max) {
    throw new ProbeConfigError(`${name} must be between ${limit.min} and ${limit.max}`);
  }
  return parsed;
}

export function assertProbeConfig(config: ProbeConfig): void {
  if (config.authorizationAck !== AUTHORIZATION_ACK) {
    throw new ProbeConfigError("Explicit local-target authorization acknowledgment is required");
  }
  const local = LOCAL_ORIGINS.includes(config.origin as (typeof LOCAL_ORIGINS)[number]);
  const container = config.allowContainerTarget && CONTAINER_ORIGINS.includes(config.origin as (typeof CONTAINER_ORIGINS)[number]);
  if (!local && !container) {
    throw new ProbeConfigError("Target origin is outside the local demonstration allowlist");
  }
  if (!ALLOWED_PATHS.includes(config.path as (typeof ALLOWED_PATHS)[number])) {
    throw new ProbeConfigError("Target path is outside the demonstration allowlist");
  }

  for (const [name, value, limit] of [
    ["maxCalls", config.maxCalls, LIMITS.maxCalls],
    ["requestTimeoutMs", config.requestTimeoutMs, LIMITS.requestTimeoutMs],
    ["totalDurationMs", config.totalDurationMs, LIMITS.totalDurationMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < limit.min || value > limit.max) {
      throw new ProbeConfigError(`${name} exceeds its permitted range`);
    }
  }
}

/** Parsing environment values is the authorization boundary for the CLI. */
export function parseProbeConfig(env: NodeJS.ProcessEnv): ProbeConfig {
  if (env.AEGISLAB_AUTHORIZATION_ACK !== AUTHORIZATION_ACK) {
    throw new ProbeConfigError("Explicit local-target authorization acknowledgment is required");
  }

  const config: ProbeConfig = {
    authorizationAck: AUTHORIZATION_ACK,
    allowContainerTarget: env.AEGISLAB_IN_CONTAINER === "1",
    origin: env.AEGISLAB_AUTHORIZED_TARGET_ORIGIN ?? "",
    path: env.AEGISLAB_TARGET_PATH ?? "/health",
    maxCalls: boundedInteger(env.AEGISLAB_MAX_CALLS, "AEGISLAB_MAX_CALLS", LIMITS.maxCalls),
    requestTimeoutMs: boundedInteger(
      env.AEGISLAB_REQUEST_TIMEOUT_MS,
      "AEGISLAB_REQUEST_TIMEOUT_MS",
      LIMITS.requestTimeoutMs,
    ),
    totalDurationMs: boundedInteger(
      env.AEGISLAB_TOTAL_DURATION_MS,
      "AEGISLAB_TOTAL_DURATION_MS",
      LIMITS.totalDurationMs,
    ),
  };

  assertProbeConfig(config);
  return config;
}
