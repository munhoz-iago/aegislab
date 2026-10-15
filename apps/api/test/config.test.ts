import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

const env = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5433/aegislab_test", ...overrides });

describe("API configuration", () => {
  it("defaults to loopback and ignores legacy HOST", () => {
    expect(readConfig(env()).host).toBe("127.0.0.1");
    expect(readConfig(env({ API_HOST: "", HOST: "0.0.0.0" })).host).toBe("127.0.0.1");
    expect(readConfig(env({ API_HOST: "::1" })).host).toBe("::1");
  });

  it("requires explicit container mode for a wildcard bind", () => {
    expect(() => readConfig(env({ API_HOST: "0.0.0.0" }))).toThrow(/API_HOST/);
    expect(readConfig(env({ API_HOST: "0.0.0.0", AEGISLAB_IN_CONTAINER: "1" })).host).toBe("0.0.0.0");
    for (const host of ["192.168.1.5", "not a host!!"]) {
      expect(() => readConfig(env({ API_HOST: host }))).toThrow(/API_HOST/);
    }
  });

  it("accepts only decimal ports in range", () => {
    expect(readConfig(env({ PORT: "" })).port).toBe(3001);
    expect(readConfig(env({ PORT: " 3001 " })).port).toBe(3001);
    for (const port of ["0x10", "1e3", "0", "65536", " 30 01 "]) {
      expect(() => readConfig(env({ PORT: port }))).toThrow(/PORT/);
    }
  });

  it("parses a small list of exact frontend origins", () => {
    expect(readConfig(env()).frontendOrigins).toEqual(["http://127.0.0.1:5173", "http://localhost:5173"]);
    expect(readConfig(env({ FRONTEND_ORIGIN: "http://127.0.0.1:5173/, http://localhost:5173" })).frontendOrigins).toEqual([
      "http://127.0.0.1:5173", "http://localhost:5173",
    ]);
    for (const origin of ["not a url", "http://127.0.0.1:5173/path", "http://127.0.0.1:5173,", "http://a.test,http://b.test,http://c.test,http://d.test,http://e.test"]) {
      expect(() => readConfig(env({ FRONTEND_ORIGIN: origin }))).toThrow(/^FRONTEND_ORIGIN/);
    }
  });
});
