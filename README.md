# AegisLab

Laboratório open source e local de engenharia de segurança de aplicações, performance e observabilidade. Esta primeira entrega é uma base executável para aprender, testar hipóteses e guardar evidências reproduzíveis. Os módulos de scanner, carga e telemetria ainda não estão integrados.

Open source, local-first lab for application security, performance, and observability engineering. This first delivery provides an executable base for learning, testing hypotheses, and recording reproducible evidence. Scanner, load, and telemetry integrations are not yet implemented.

## O que funciona / What works

| Componente / Component | Entrega atual / Current delivery |
| --- | --- |
| API | Express + TypeScript; cadastro, login, sessão e painel protegido / registration, login, session, and protected dashboard |
| Banco / Database | PostgreSQL com esquema e migração Drizzle / PostgreSQL with Drizzle schema and migration |
| Interface / UI | React + Vite + Tailwind; acesso e painel responsivo / sign-in and responsive dashboard |
| Alvo local / Local target | Respostas fixas e sintéticas / fixed synthetic responses |
| Worker e scanners / Worker and scanners | CLI e sonda GET separada, com escopo e recursos limitados / separate CLI and bounded GET probe |
| Verificação / Verification | Vitest, Supertest e Playwright, localmente e no GitHub Actions (`main` aprovado em 15/10/2026; veja `docs/evidence.md`) / locally and in GitHub Actions (`main` passed on 2026-10-15; see `docs/evidence.md`) |

Hashcat, OWASP ZAP, Semgrep, Gitleaks, Trivy, k6, Autocannon, OpenTelemetry, Prometheus e Grafana estão no roteiro, não no código executável desta fase. Nenhum resultado de scanner ou métrica de performance é simulado como se fosse medição real.

Hashcat, OWASP ZAP, Semgrep, Gitleaks, Trivy, k6, Autocannon, OpenTelemetry, Prometheus, and Grafana are on the roadmap, not integrated in this phase. No scanner result or performance metric is presented as an observed measurement.

## Início rápido com Docker / Docker quick start

Requisitos: Docker Desktop com o daemon ativo. As portas publicadas ficam restritas a `127.0.0.1`.

Requirements: Docker Desktop with a running daemon. Published ports bind to `127.0.0.1` only.

1. Copie `.env.example` para `.env` e preencha `POSTGRES_PASSWORD` com um segredo novo, alfanumérico. Não faça commit desse arquivo. Para rodar a API fora do Docker, configure também `DATABASE_URL=postgresql://aegislab:<mesmo-segredo>@127.0.0.1:5433/aegislab`.
2. Execute `docker compose up --build -d` na raiz do projeto.
3. Abra `http://127.0.0.1:5173`, crie uma conta local e entre. A senha deve ter 12 a 128 caracteres.
4. Verifique `docker compose ps`, `http://127.0.0.1:3001/api/health` e `http://127.0.0.1:4100/health`.
5. Para parar, execute `docker compose down`. Use `docker compose down -v` apenas se quiser apagar os dados locais do banco.

1. Copy `.env.example` to `.env` and fill `POSTGRES_PASSWORD` with a new alphanumeric secret. Do not commit this file. To run the API outside Docker, also set `DATABASE_URL=postgresql://aegislab:<same-secret>@127.0.0.1:5433/aegislab`.
2. Run `docker compose up --build -d` from the project root.
3. Open `http://127.0.0.1:5173`, register a local account, and sign in. Passwords must be 12–128 characters.
4. Check `docker compose ps`, `http://127.0.0.1:3001/api/health`, and `http://127.0.0.1:4100/health`.
5. Stop with `docker compose down`. Use `docker compose down -v` only when you intend to delete local database data.

On the development host used for this first delivery, Docker containers received `ECONNRESET` when contacting the official npm registry. A verified image was built through a temporary local relay to that same registry; the running services were started with `docker compose up -d --no-build --pull never`. This is an environment-specific build limitation, not a passing result for the default Docker build command.

No computador usado nesta entrega, os contêineres receberam `ECONNRESET` ao acessar o registro npm oficial. A imagem foi construída por um acesso local temporário ao mesmo registro e os serviços iniciaram com `docker compose up -d --no-build --pull never`. Essa é uma limitação do ambiente; o comando padrão de build não foi validado como bem-sucedido nele.

## Desenvolvimento / Development

Use Node.js 24 (tested; declared minimum 22.13) and pnpm 11. Install Chromium before browser tests. On Linux, use `playwright install --with-deps chromium`.

Use Node.js 24 (testado; mínimo declarado 22.13) e pnpm 11. Instale o Chromium antes dos testes de navegador. No Linux, use `playwright install --with-deps chromium`.

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @aegislab/web exec playwright install chromium
pnpm test:e2e
```

For local development, stop the Compose app services with `docker compose stop api web demo-target`, then start PostgreSQL with `docker compose up -d --wait db`. Fill `DATABASE_URL` in `.env`, run `pnpm db:migrate`, then `pnpm dev`. Otherwise the app ports collide. The API, UI, and demo target run as separate processes. Run `pnpm dev:worker` only with the authorization variables below.

Para desenvolver localmente, pare os serviços de aplicação do Compose com `docker compose stop api web demo-target` e suba o banco com `docker compose up -d --wait db`. Configure `DATABASE_URL` em `.env`, rode `pnpm db:migrate` e depois `pnpm dev`; sem parar os serviços, as portas entram em conflito. Rode `pnpm dev:worker` somente com as variáveis de autorização abaixo.

The Playwright suite builds the current working tree and serves it on `127.0.0.1:5174` with intercepted API responses. It cannot silently reuse the Compose UI on 5173. `docs/evidence.md` records a separate run against the real Compose API and PostgreSQL database.

A suíte Playwright compila o código local e o serve em `127.0.0.1:5174` com respostas interceptadas da API. Ela não reutiliza silenciosamente a interface do Compose na porta 5173. `docs/evidence.md` registra a execução separada contra a API e o PostgreSQL reais.

### Integration tests / Testes de integração

Start an isolated PostgreSQL test database. The API PostgreSQL tests are skipped unless `TEST_DATABASE_URL` points to a loopback database ending in `_test`.

Crie um banco de teste isolado. Os testes PostgreSQL da API são ignorados quando `TEST_DATABASE_URL` não aponta para um banco local terminado em `_test`.

```powershell
docker compose up -d --wait db
docker compose exec -T db createdb -U aegislab aegislab_test
$env:TEST_DATABASE_URL = 'postgresql://aegislab:<secret>@127.0.0.1:5433/aegislab_test'
pnpm test
```

For POSIX shells / Em shells POSIX:

```sh
TEST_DATABASE_URL='postgresql://aegislab:<secret>@127.0.0.1:5433/aegislab_test' pnpm test
```

With Compose running, use `pnpm test:api-live` for the real HTTP auth flow and `pnpm test:live` for the real Chromium UI flow. Each creates a synthetic local account; repeated runs can hit the API's registration rate limit. Com o Compose ativo, esses dois comandos verificam a autenticação HTTP e a interface contra o banco real; execuções repetidas podem atingir o limite de cadastros.

`pnpm test:db-recovery` restarts and then pauses the local Compose `db` service, checks that `/api/health` reports `503` during the outage, that a session lookup returns `503 database_unavailable` within a few seconds instead of hanging, and that the same API process recovers and passes `test:api-live` afterwards. It interrupts the local database, so it only runs with `AEGISLAB_DISRUPT_LOCAL_DB=1` (PowerShell: `$env:AEGISLAB_DISRUPT_LOCAL_DB = '1'`). Data in the volume is kept.

`pnpm test:db-recovery` reinicia e depois pausa o serviço `db` local do Compose. Ele confirma que `/api/health` responde `503` durante a falha, que uma consulta de sessão retorna `503 database_unavailable` em poucos segundos em vez de travar e que o mesmo processo da API se recupera e passa em `test:api-live` em seguida. Como interrompe o banco local, só roda com `AEGISLAB_DISRUPT_LOCAL_DB=1` (PowerShell: `$env:AEGISLAB_DISRUPT_LOCAL_DB = '1'`). Os dados do volume são mantidos.

## Execução autorizada / Authorized execution

O worker desta fase faz apenas GET em `/health` ou `/api/synthetic-cases` de **uma** origem configurada explicitamente. Não recebe URL da interface ou da API, não envia corpo de resposta para logs e não executa scanners externos. O padrão limita a três chamadas, uma por vez, até 1 segundo por chamada e 3 segundos no total; o Compose acrescenta limites de CPU, memória e processos.

The worker makes GET requests only to `/health` or `/api/synthetic-cases` on **one** explicitly configured origin. It accepts no target URL from the UI or API, does not log response bodies, and runs no external scanners. Defaults limit execution to three sequential calls, one second each, and three seconds total; Compose adds CPU, memory, and process limits.

Depois de confirmar que o alvo local é seu, execute pelo Compose:

```powershell
docker compose --profile probe run --rm -e AEGISLAB_AUTHORIZATION_ACK=I_OWN_THIS_LOCAL_TARGET worker
```

After confirming you own the local target, run the same Compose command. Acknowledgment is required for each run. The worker returns 0 for a reachable target, 2 for a failed probe, and 1 for rejected configuration. These are availability checks, never benchmarks.

Para executar o worker diretamente no Windows, com o alvo sintético em `127.0.0.1:4100`:

```powershell
$env:AEGISLAB_AUTHORIZATION_ACK = 'I_OWN_THIS_LOCAL_TARGET'
$env:AEGISLAB_AUTHORIZED_TARGET_ORIGIN = 'http://127.0.0.1:4100'
pnpm dev:worker
```

For direct local execution, set the same variables and run `pnpm dev:worker`; see [the worker guide](apps/worker/README.md). The local allowlist accepts `127.0.0.1` only. `localhost` and `[::1]` are not accepted probe origins.

Nunca aponte este laboratório para um serviço de terceiros sem autorização explícita e uma revisão de escopo separada; a confirmação é exigida a cada execução.

Never point this lab at a third-party service without explicit authorization and a separate scope review; acknowledgment is required for every run.

## Estrutura / Structure

- `apps/api`: autenticação, API e acesso ao PostgreSQL / authentication, API, PostgreSQL access.
- `apps/web`: interface e testes de UI / interface and UI tests.
- `apps/demo-target`: serviço seguro de dados sintéticos / safe synthetic-data service.
- `apps/worker`: exemplo de execução limitada / bounded execution example.
- `packages/scanners`: política e sonda GET local; ferramentas externas ainda não integradas / local GET policy and probe; external tools remain unintegrated.
- `docs/architecture.md`: decisões e limites de confiança / decisions and trust boundaries.
- `docs/evidence.md`: hipóteses, comandos, resultados observados e limitações / hypotheses, commands, observed results, and limitations.

## Roteiro / Roadmap

As próximas fases devem acrescentar adaptadores de ferramentas em processos isolados, inventário explícito de alvos autorizados, fila de tarefas, coleta OpenTelemetry, métricas Prometheus/Grafana e cenários de performance k6/Autocannon. Cada integração precisa de teste real, limite de recursos, registro da hipótese e evidência antes de aparecer como disponível no painel.

Later phases can add isolated tool adapters, an explicit authorized-target inventory, a job queue, OpenTelemetry collection, Prometheus/Grafana metrics, and k6/Autocannon scenarios. Each integration needs a real test, resource bounds, a recorded hypothesis, and evidence before the dashboard marks it available.

## Licença / License

MIT. See `LICENSE`.
