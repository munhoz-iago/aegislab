import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { resolveHost, startDemoTarget } from "../src/start.js";

describe("demo target listener", () => {
  it("defaults to loopback and ignores HOST", () => {
    expect(resolveHost({})).toBe("127.0.0.1");
    expect(resolveHost({ HOST: "0.0.0.0" })).toBe("127.0.0.1");
    expect(() => resolveHost({ DEMO_TARGET_HOST: "0.0.0.0" })).toThrow();
    expect(resolveHost({ DEMO_TARGET_HOST: "0.0.0.0", AEGISLAB_IN_CONTAINER: "1" })).toBe("0.0.0.0");
    expect(() => resolveHost({ DEMO_TARGET_HOST: "192.168.1.1", AEGISLAB_IN_CONTAINER: "1" })).toThrow();
  });

  it("rejects a busy port instead of reporting success", async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("Missing bound port");
    try {
      await expect(startDemoTarget({ host: "127.0.0.1", port: address.port })).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await new Promise<void>((resolve, reject) => occupied.close((error) => error ? reject(error) : resolve()));
    }
  });
});
