# API / API

## Português (Brasil)

Esta API fornece apenas a base do laboratório: cadastro, login, sessão, estado de prontidão do PostgreSQL e um dashboard que identifica módulos disponíveis ou planejados. Nenhum endpoint executa varreduras, recuperação de hashes ou testes de carga.

### Decisões

- Express isola o transporte HTTP; `AuthRepository` separa as rotas do PostgreSQL, e Drizzle define o esquema.
- Senhas recebem `scrypt` com salt aleatório. O banco guarda somente o hash SHA-256 de cada token de sessão aleatório; o token vai para um cookie `HttpOnly`, `SameSite=Strict`, restrito a `/api`, com validade de oito horas. Em HTTPS, o cookie também recebe `Secure`.
- Requisições POST exigem um `Origin` da lista explícita `FRONTEND_ORIGIN` (até quatro origens). Por padrão, `http://127.0.0.1:5173` e `http://localhost:5173` são aceitas. Cadastro e login têm limites de 5 e 10 tentativas por janela de dez minutos. O limite usa o IP do socket; clientes atrás do proxy Vite compartilham a mesma chave. Cabeçalhos `X-Forwarded-For` não são confiados. O corpo JSON tem limite de 16 KB.
- A API escuta em `127.0.0.1` por padrão. `API_HOST=::1` também é aceito; `API_HOST=0.0.0.0` exige `AEGISLAB_IN_CONTAINER=1`. A variável antiga `HOST` é ignorada. `PORT` aceita apenas dígitos decimais de 1 a 65535.
- A consulta de prontidão tem prazo de 1 segundo; consultas PostgreSQL têm prazo de 5 segundos. Erros de conexões ociosas do pool são tratados sem expor mensagens de exceção. Logs JSON usam campos fechados e nunca incluem corpo, e-mail, cookie, URL ou parâmetros de consulta.
- Sessões expiradas deixam de autenticar imediatamente e são removidas em lotes de até 100 linhas; uma varredura remove no máximo 1.000 linhas na inicialização e a cada 15 minutos. O encerramento aguarda requisições em curso e depois fecha o pool, com prazo de oito segundos.
- O endpoint `/api/health` consulta o banco e retorna 503 quando ele não está disponível. O dashboard não informa métricas ou resultados de ferramentas que ainda não foram executadas.
- Quando o PostgreSQL está inacessível, as rotas que dependem do banco (`/api/auth/me`, `/api/dashboard`, login, cadastro e logout) respondem `503` com o código `database_unavailable` e `Retry-After: 5`, em vez de `500`. Contam como indisponibilidade: tempo esgotado ao obter conexão do pool, `Query read timeout`, conexão perdida, recusada ou redefinida (`ECONNREFUSED`, `ECONNRESET` e afins) e os SQLSTATE `57P01`–`57P03` e da classe `08`. Qualquer outro erro continua como `500 internal_error`. O log registra o evento `database_unavailable` com um `reason` de valores fechados (`connect_timeout`, `connect_failed`, `connection_lost`, `query_timeout`, `server_unavailable`), sem a mensagem da exceção.

### Configuração e comandos

Crie `.env` na raiz do monorepo a partir de `.env.example`, com `DATABASE_URL` apontando para seu PostgreSQL local. Nunca versione esse arquivo. `FRONTEND_ORIGIN` é opcional e recebe as duas origens locais acima. A API lê `.env` da raiz em desenvolvimento; variáveis do ambiente têm precedência. Por padrão, o servidor escuta apenas em `127.0.0.1:3001`.

```text
pnpm --filter @aegislab/api db:generate
pnpm --filter @aegislab/api db:migrate
pnpm --filter @aegislab/api dev
pnpm --filter @aegislab/api typecheck
pnpm --filter @aegislab/api test
```

O teste de integração com PostgreSQL só executa quando `TEST_DATABASE_URL` é definido explicitamente para um banco local cujo nome termina em `_test`. Ele aplica as migrações nesse banco dedicado. Os demais testes usam um repositório em memória para verificar rotas e proteções sem exigir infraestrutura. A suíte também verifica as falhas de bind, os prazos de consulta e a limpeza de sessões.

### Limitações

O limitador de tentativas usa memória do processo, não coordena múltiplas instâncias e compartilha a chave do proxy Vite para clientes locais. A identificação dos tempos esgotados depende das mensagens exatas do `pg` 8 e do `pg-pool` 3; se uma atualização do driver mudar esses textos, a resposta volta a ser `500` até a lista ser ajustada. Os testes com o `pg` real cobrem apenas o tempo esgotado de conexão e a porta recusada; `Query read timeout` e conexão perdida são verificados só com erros simulados. A limpeza de sessões é limitada a 1.000 linhas por varredura; lotes restantes aguardam a próxima execução. O esquema de autenticação é para este laboratório local, sem recuperação de senha ou provedores externos.

## English

This API provides the lab foundation only: registration, login, sessions, PostgreSQL readiness, and a dashboard showing available or planned modules. No endpoint runs scans, hash recovery, or load tests.

Express handles HTTP, `AuthRepository` isolates persistence, and Drizzle defines the PostgreSQL schema. Passwords use salted `scrypt`; the database stores only SHA-256 hashes of random session tokens. Session cookies are `HttpOnly`, `SameSite=Strict`, scoped to `/api`, and expire after eight hours. HTTPS also enables `Secure`.

POST requests require one of up to four configured `FRONTEND_ORIGIN` values; the default includes both `127.0.0.1:5173` and `localhost:5173`. Registration and login allow 5 and 10 attempts per ten minutes. The process uses the socket IP, so local clients behind Vite share a bucket, and forwarded IP headers are ignored. JSON bodies are capped at 16 KB. The API binds to `127.0.0.1` by default; `0.0.0.0` requires `API_HOST=0.0.0.0` and `AEGISLAB_IN_CONTAINER=1`. `PORT` is strict decimal. `/api/health` has a one-second deadline and PostgreSQL queries have a five-second deadline. `TEST_DATABASE_URL` enables integration tests only against a loopback database ending in `_test`.

When PostgreSQL is unreachable, DB-backed routes (`/api/auth/me`, `/api/dashboard`, login, registration, and logout) return `503` with code `database_unavailable` and `Retry-After: 5` instead of `500`. Unavailability means a pool connection timeout, `Query read timeout`, a lost, refused, or reset connection (`ECONNREFUSED`, `ECONNRESET`, and similar), or SQLSTATE `57P01`–`57P03` or class `08`. Every other error stays `500 internal_error`. The `database_unavailable` log event carries a closed `reason` value (`connect_timeout`, `connect_failed`, `connection_lost`, `query_timeout`, `server_unavailable`) and never the exception message.

Expired sessions are purged in bounded batches at startup and every 15 minutes. The JSON logger records fixed fields only, and graceful shutdown waits for in-flight requests before closing the pool. The rate limiter is process-local and does not coordinate multiple instances. Timeout detection matches exact `pg` 8 and `pg-pool` 3 messages; if a driver upgrade changes them, those failures fall back to `500` until the list is updated. The real-`pg` tests cover only the connection timeout and a refused port; `Query read timeout` and lost connections are checked with simulated errors only. Password recovery and external identity providers are outside this foundation.
