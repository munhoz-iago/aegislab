# Safe demonstration target / Alvo de demonstração seguro

## Português (Brasil)

Serviço Express isolado para exercícios locais. `GET /health` informa disponibilidade; `GET /api/synthetic-cases` entrega três registros fixos, explicitamente sintéticos. Não contém contas, credenciais, hashes, dados pessoais ou falhas intencionais. Rotas desconhecidas retornam JSON 404.

Por padrão, escuta em `127.0.0.1:4100`. O Compose define `HOST=0.0.0.0` dentro do contêiner e publica a porta apenas no loopback do computador.

```sh
pnpm --filter @aegislab/demo-target dev
pnpm --filter @aegislab/demo-target test
```

Os testes verificam as respostas, a identificação dos dados sintéticos e cabeçalhos básicos. Eles não constituem auditoria de segurança nem demonstram resistência a ataques.

**Evidência local em 14/10/2026:** `typecheck` e `build` terminaram com código 0; o Vitest passou em 3 de 3 testes. O servidor compilado respondeu a duas consultas de saúde usadas na verificação local do worker. Esta observação não valida o contêiner nem exposição em outras redes.

## English

Isolated Express service for local exercises. `GET /health` reports availability; `GET /api/synthetic-cases` returns three fixed records explicitly marked synthetic. It has no accounts, credentials, hashes, personal data, or intentional vulnerabilities. Unknown routes return JSON 404.

By default it listens on `127.0.0.1:4100`. Compose sets `HOST=0.0.0.0` inside the container and publishes the port only to the host loopback interface.

The tests cover responses, synthetic labeling, and basic headers. They are not a security audit or evidence of resistance to attacks.

**Local evidence on 2026-10-14:** type checking and build exited with code 0; Vitest passed 3 of 3 tests. The compiled server answered two health requests used in the worker's local check. This does not validate the container or other network exposure.
