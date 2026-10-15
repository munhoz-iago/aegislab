# AegisLab contributor guide

## Purpose

AegisLab is an educational, reproducible Application Security Engineering, Performance Engineering, and Observability lab. The foundation consists of a local-only dashboard, authenticated API, PostgreSQL database, synthetic demo target, and bounded local worker. Scanner integrations are future work until implemented and verified.

## Non-negotiable boundaries

- Run experiments only against local services or targets with explicit written authorization. The foundation worker permits only its single configured origin and fixed read-only paths.
- Use synthetic data for hash recovery experiments. Never ingest, print, commit, or publish real hashes, credentials, secrets, captured traffic, or sensitive reports.
- Bound every workload by target scope, duration, call count, concurrency, and response size. Keep Docker host ports bound to `127.0.0.1`.
- Treat sample values and simulated numbers as demonstrations, never as observed results.
- Do not claim ZAP, Semgrep, Gitleaks, Trivy, Hashcat, k6, Autocannon, OpenTelemetry, Prometheus, or Grafana are integrated until executable integration and evidence exist.

## Work pattern

1. State the hypothesis and architectural decision for a small change.
2. Implement typed code and meaningful automated tests.
3. Run the tests and record the exact command, observed result, and limitation in `docs/evidence.md`.
4. Fix failures before claiming the change works.
5. Update English and Brazilian Portuguese documentation for user-facing changes.
6. Commit small, objective changes. Stage exact paths to avoid including local secrets or reports.

## Structure

- `apps/api`: Express API, authentication, and Drizzle/PostgreSQL schema.
- `apps/web`: React/Vite/Tailwind dashboard.
- `apps/demo-target`: safe synthetic local target.
- `apps/worker`: bounded CLI orchestration.
- `packages/scanners`: local probe policy and adapter. It does not invoke third-party scanners.

Read `README.md` and `docs/architecture.md` before extending the foundation.
