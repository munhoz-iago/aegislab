import express, { type Express } from "express";

/** Public, fixed examples. No identities, passwords, tokens, or captured traffic. */
const syntheticCases = [
  {
    id: "SYN-001",
    area: "authentication",
    topic: "Session expiration",
    status: "illustrative_only",
  },
  {
    id: "SYN-002",
    area: "api",
    topic: "Input validation",
    status: "illustrative_only",
  },
  {
    id: "SYN-003",
    area: "observability",
    topic: "Request metrics",
    status: "illustrative_only",
  },
] as const;

export function createDemoTargetApp(): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "demo-target" });
  });

  app.get("/api/synthetic-cases", (_request, response) => {
    response.status(200).json({ synthetic: true, cases: syntheticCases });
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "not_found" });
  });

  return app;
}
