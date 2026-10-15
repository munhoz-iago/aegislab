export type DatabaseUnavailableReason = "connect_timeout" | "connect_failed" | "connection_lost" | "query_timeout" | "server_unavailable";

// Exact messages created by pg 8 and pg-pool 3. Exact matching keeps query text or parameters
// in a wrapping DrizzleQueryError message from selecting a reason.
const MESSAGE_REASONS = new Map<string, DatabaseUnavailableReason>([
  ["timeout exceeded when trying to connect", "connect_timeout"],
  ["Connection terminated due to connection timeout", "connect_timeout"],
  ["timeout expired", "connect_timeout"],
  ["Query read timeout", "query_timeout"],
  ["Connection terminated unexpectedly", "connection_lost"],
  ["Client has encountered a connection error and is not queryable", "connection_lost"],
]);

const CODE_REASONS = new Map<string, DatabaseUnavailableReason>([
  ["ECONNREFUSED", "connect_failed"],
  ["ENOTFOUND", "connect_failed"],
  ["EAI_AGAIN", "connect_failed"],
  ["EHOSTUNREACH", "connect_failed"],
  ["ENETUNREACH", "connect_failed"],
  ["ETIMEDOUT", "connect_failed"],
  ["ECONNRESET", "connection_lost"],
  ["EPIPE", "connection_lost"],
  // SQLSTATE 57P01 admin_shutdown, 57P02 crash_shutdown, 57P03 cannot_connect_now.
  ["57P01", "server_unavailable"],
  ["57P02", "server_unavailable"],
  ["57P03", "server_unavailable"],
]);

/** Returns why PostgreSQL could not serve a request, or null for any other failure (including bugs). */
export function databaseUnavailableReason(error: unknown): DatabaseUnavailableReason | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const code = "code" in current && typeof current.code === "string" ? current.code : undefined;
    if (code) {
      const reason = CODE_REASONS.get(code) ?? (/^08[0-9A-Z]{3}$/.test(code) ? "server_unavailable" : undefined);
      if (reason) return reason;
    }
    if ("message" in current && typeof current.message === "string") {
      const reason = MESSAGE_REASONS.get(current.message);
      if (reason) return reason;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return null;
}
