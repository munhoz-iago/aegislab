/** Only these fields may be logged. Never pass error messages, request bodies, headers, or query parameters. */
export interface LogFields {
  level: "info" | "warn" | "error";
  requestId?: string;
  method?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  errorName?: string;
  pgCode?: string;
  reason?: string;
  count?: number;
}

export interface Logger {
  event(name: string, fields: LogFields): void;
}

export function createLogger(write: (line: string) => void = (line) => process.stdout.write(line)): Logger {
  return {
    event(name, fields) {
      // Copy known keys explicitly so an extra runtime property cannot leak into the log.
      const { level, requestId, method, route, status, durationMs, errorName, pgCode, reason, count } = fields;
      write(`${JSON.stringify({
        ts: new Date().toISOString(),
        event: name,
        level,
        requestId,
        method,
        route,
        status,
        durationMs,
        errorName: safeIdentifier(errorName),
        pgCode: safeIdentifier(pgCode),
        reason,
        count,
      })}\n`);
    },
  };
}

export const noopLogger: Logger = { event() {} };

export function errorFields(error: unknown): Pick<LogFields, "errorName" | "pgCode"> {
  let current: unknown = error;
  let errorName: string | undefined;
  let pgCode: string | undefined;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if (!errorName && "name" in current && typeof current.name === "string") errorName = current.name;
    if (!pgCode && "code" in current && typeof current.code === "string") pgCode = current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return { errorName: safeIdentifier(errorName), pgCode: safeIdentifier(pgCode) };
}

function safeIdentifier(value: string | undefined): string | undefined {
  return value && /^[A-Za-z0-9_]{1,40}$/.test(value) ? value : undefined;
}
