# Scanner core / Núcleo de verificações

## Português (Brasil)

`@aegislab/scanners` reúne a política de destinos permitidos e a verificação HTTP de disponibilidade. Nesta primeira entrega, o nome **não** significa integração com Hashcat, ZAP, Semgrep, Gitleaks, Trivy, k6 ou Autocannon. Nenhuma dessas ferramentas é chamada pelo pacote.

A API pública exporta `parseProbeConfig`, `assertProbeConfig` e `runProbe`, além dos tipos correspondentes. A configuração exige declaração explícita de autorização e uma origem exata na porta 4100: loopback ou serviço Compose `demo-target`. Aceita somente `/health` ou `/api/synthetic-cases`. O probe usa `GET` sequencial, não segue redirecionamentos, cancela o corpo antes de outra chamada e registra apenas status e tempo, nunca corpo ou cabeçalhos. Há limites rígidos de 10 chamadas, 2.000 ms por chamada e 10.000 ms no total; timeout ou falha ao cancelar o corpo encerra a execução para impedir sobreposição de requisições.

```sh
pnpm --filter @aegislab/scanners typecheck
pnpm --filter @aegislab/scanners test
pnpm --filter @aegislab/scanners build
```

**Hipótese dos testes:** destinos fora da lista e configurações acima dos limites são rejeitados; respostas HTTP permitidas geram resumo sem conteúdo sensível. **Limitação:** os testes com transporte substituto não provam isolamento de rede do contêiner nem desempenho sob carga. O reconhecimento de autorização é uma declaração do operador, não prova de propriedade.

**Resultado observado em 14/10/2026:** `typecheck` e `build` terminaram com código 0; o Vitest passou em 8 de 8 testes. Isso inclui cancelamento do corpo antes da chamada seguinte, parada após falha de cancelamento e limite de tempo para um cancelamento travado. O pacote extraído ainda não foi verificado nesta etapa contra o Compose.

## English

`@aegislab/scanners` holds the destination policy and HTTP availability probe. In this first delivery, its name does **not** imply integrations with Hashcat, ZAP, Semgrep, Gitleaks, Trivy, k6, or Autocannon. The package invokes none of them.

Its public API exports `parseProbeConfig`, `assertProbeConfig`, and `runProbe`, with related types. Configuration requires an explicit authorization acknowledgment and an exact origin on port 4100: loopback or the Compose `demo-target` service. Only `/health` and `/api/synthetic-cases` are accepted. The probe uses sequential `GET`, does not follow redirects, cancels each body before another call, and records status and elapsed time only. Hard limits are 10 calls, 2,000 ms per call, and 10,000 ms total; a timeout or body cleanup failure stops the run to avoid overlapping requests.

**Test hypothesis:** disallowed destinations and excessive limits are rejected; allowed HTTP responses yield a summary without sensitive content. **Limitation:** tests using a substitute transport do not prove container network isolation or load performance. The authorization acknowledgment is an operator statement, not proof of ownership.

**Observed on 2026-10-14:** type checking and build exited with code 0; Vitest passed 8 of 8 tests. These include body cancellation before the next call, stopping after cancellation failure, and bounding a stalled cancellation. The extracted package has not yet been checked against Compose at this stage.
