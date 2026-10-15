import { describe, expect, it } from "vitest";
import { createLogger } from "../src/observability/log.js";

describe("closed-field logger", () => {
  it("writes one parseable JSON line with an ISO timestamp", () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));
    logger.event("probe", { level: "info", count: 2 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\n$/);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "probe", level: "info", count: 2 });
    expect(new Date(JSON.parse(lines[0]!).ts).toISOString()).toBe(JSON.parse(lines[0]!).ts);
  });
});
