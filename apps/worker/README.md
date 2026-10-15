# Bounded local probe / Verificação local limitada

## Português (Brasil)

O worker é a entrada de linha de comando para a verificação simples de disponibilidade por `GET`. Ele recebe a configuração, chama `@aegislab/scanners` e apresenta o resumo. O pacote de scanners impõe uma chamada por vez, origens exatas do alvo local na porta 4100 (`127.0.0.1`, `localhost`, `[::1]` ou serviço Compose `demo-target`) e apenas `/health` ou `/api/synthetic-cases`. Redirecionamentos não são seguidos. Corpo e cabeçalhos das respostas não entram no resultado.

Uma execução exige uma declaração explícita de autorização e a origem selecionada:

```powershell
$env:AEGISLAB_AUTHORIZATION_ACK = 'I_OWN_THIS_LOCAL_TARGET'
$env:AEGISLAB_AUTHORIZED_TARGET_ORIGIN = 'http://127.0.0.1:4100'
pnpm --filter @aegislab/worker dev
```

Inicie o alvo em outro terminal antes do worker. O perfil `probe` do Compose fornece a origem `http://demo-target:4100`, mas a declaração de autorização continua obrigatória.

Limites padrão: 3 chamadas; 1.000 ms por chamada; 3.000 ms no total. Máximos aceitos: 10 chamadas; 2.000 ms por chamada; 10.000 ms no total. A concorrência é sempre 1. As variáveis `AEGISLAB_MAX_CALLS`, `AEGISLAB_REQUEST_TIMEOUT_MS` e `AEGISLAB_TOTAL_DURATION_MS` só podem reduzir ou aumentar esses valores dentro dos limites rígidos.

Os comandos `dev` e `start` limitam o heap V8 a 96 MiB. O Compose também limita CPU, memória e processos do contêiner. A declaração de autorização é uma atestação do operador, não uma prova técnica de propriedade do alvo; a lista fixa de destinos locais impõe o escopo adicional.

**Hipótese do experimento:** com o alvo local em execução, `/health` responde com um status HTTP. **Comando:** iniciar o alvo e executar o worker com as variáveis acima. **Resultado registrado:** status HTTP e tempo por tentativa, sem conteúdo da resposta. **Limitação:** disponibilidade e tempo de resposta não demonstram segurança, desempenho sob carga ou integração com scanners externos.

**Evidência local em 14/10/2026:** após a separação em pacotes, `typecheck` e `build` terminaram com código 0; o Vitest passou em 2 de 2 testes do worker e 8 de 8 do pacote de scanners. A CLI compilada, executada sem autorização, saiu com código 1 e somente a mensagem fixa de recusa. Uma execução autorizada via CLI e o perfil Compose ainda não foram verificados de ponta a ponta nesta etapa.

## English

The worker is the command line entry point for a simple `GET` availability check. It receives configuration, calls `@aegislab/scanners`, and prints the summary. The scanners package enforces sequential calls, exact local target origins on port 4100 (`127.0.0.1`, `localhost`, `[::1]`, or the Compose service `demo-target`), and only `/health` or `/api/synthetic-cases`. It never follows redirects or records response bodies or headers.

Each run requires the explicit authorization acknowledgment and selected origin shown above. The Compose `probe` profile supplies the service origin but still requires authorization.

Defaults: 3 calls, 1,000 ms per call, and 3,000 ms total. Hard maxima: 10 calls, 2,000 ms per call, and 10,000 ms total. Concurrency is always 1.

The `dev` and `start` commands cap the V8 heap at 96 MiB. Compose also limits container CPU, memory, and process count. The authorization acknowledgment is an operator attestation, not technical proof of target ownership; the fixed local destination list adds a scope boundary.

**Experiment hypothesis:** when the local target is running, `/health` returns an HTTP status. **Command:** start the target, then run the worker with the variables above. **Recorded result:** status and elapsed time per attempt, without response content. **Limitation:** availability and response time do not demonstrate security, load performance, or external scanner integration.

**Local evidence on 2026-10-14:** after the package split, type checking and build exited with code 0; Vitest passed 2 of 2 worker tests and 8 of 8 scanner tests. The compiled CLI, run without authorization, exited with code 1 and only the fixed rejection message. An authorized CLI run and the Compose profile have not yet been verified end to end at this stage.
