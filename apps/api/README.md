# API / API

## Português (Brasil)

Esta API fornece apenas a base do laboratório: cadastro, login, sessão, estado de prontidão do PostgreSQL e um dashboard que identifica módulos disponíveis ou planejados. Nenhum endpoint executa varreduras, recuperação de hashes ou testes de carga.

### Decisões

- Express isola o transporte HTTP; `AuthRepository` separa as rotas do PostgreSQL, e Drizzle define o esquema.
- Senhas recebem `scrypt` com salt aleatório. O banco guarda somente o hash SHA-256 de cada token de sessão aleatório; o token vai para um cookie `HttpOnly`, `SameSite=Strict`, restrito a `/api`, com validade de oito horas. Em HTTPS, o cookie também recebe `Secure`.
- Requisições POST exigem `Origin` igual a `FRONTEND_ORIGIN`. Cadastro e login têm limites por IP do socket em janelas de dez minutos (5 e 10 tentativas). O corpo JSON tem limite de 16 KB. Cabeçalhos `X-Forwarded-For` não são confiados.
- O endpoint `/api/health` consulta o banco e retorna 503 quando ele não está disponível. O dashboard não informa métricas ou resultados de ferramentas que ainda não foram executadas.

### Configuração e comandos

Crie `.env` na raiz do monorepo a partir de `.env.example`, com `DATABASE_URL` apontando para seu PostgreSQL local. Nunca versione esse arquivo. `FRONTEND_ORIGIN` é opcional e assume `http://127.0.0.1:5173`. A API lê `.env` da raiz em desenvolvimento; variáveis do ambiente têm precedência. Por padrão, o servidor escuta apenas em `127.0.0.1:3001`.

```text
pnpm --filter @aegislab/api db:generate
pnpm --filter @aegislab/api db:migrate
pnpm --filter @aegislab/api dev
pnpm --filter @aegislab/api typecheck
pnpm --filter @aegislab/api test
```

O teste de integração com PostgreSQL só executa quando `TEST_DATABASE_URL` é definido explicitamente para um banco local cujo nome termina em `_test`. Ele aplica as migrações nesse banco dedicado. Os demais testes usam um repositório em memória para verificar rotas e proteções sem exigir infraestrutura.

### Limitações

O limitador de tentativas usa memória do processo e não coordena múltiplas instâncias. Sessões expiradas deixam de autenticar imediatamente, mas a limpeza física das linhas do banco ainda não é agendada. O esquema de autenticação é para este laboratório local, sem recuperação de senha ou provedores externos.

## English

This API provides the lab foundation only: registration, login, sessions, PostgreSQL readiness, and a dashboard showing available or planned modules. No endpoint runs scans, hash recovery, or load tests.

Express handles HTTP, `AuthRepository` isolates persistence, and Drizzle defines the PostgreSQL schema. Passwords use salted `scrypt`; the database stores only SHA-256 hashes of random session tokens. Session cookies are `HttpOnly`, `SameSite=Strict`, scoped to `/api`, and expire after eight hours. HTTPS also enables `Secure`.

POST requests require the configured `FRONTEND_ORIGIN`; registration and login have per-socket-IP attempt limits (5 and 10 per ten minutes), and JSON bodies are capped at 16 KB. `/api/health` checks PostgreSQL readiness. `TEST_DATABASE_URL` enables integration tests only against a loopback database ending in `_test`. Other tests use an in-memory repository.

The rate limiter is process-local, expired database rows have no scheduled cleanup yet, and password recovery or external identity providers are outside this foundation.
