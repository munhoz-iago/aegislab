import request from "supertest";
import { describe, expect, it } from "vitest";
import { createDemoTargetApp } from "../src/app.js";

describe("safe demonstration target", () => {
  const app = createDemoTargetApp();

  it("serves a minimal health response", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "demo-target" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("labels all demonstration records as synthetic", async () => {
    const response = await request(app).get("/api/synthetic-cases");

    expect(response.status).toBe(200);
    expect(response.body.synthetic).toBe(true);
    expect(response.body.cases).toHaveLength(3);
    expect(response.body.cases.every((item: { id: string }) => item.id.startsWith("SYN-"))).toBe(true);
    expect(response.body.cases.every((item: { status: string }) => item.status === "illustrative_only")).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/password|secret|token|hash/i);
  });

  it("returns a bounded 404 for unknown routes", async () => {
    const response = await request(app).get("/unknown");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "not_found" });
  });
});
