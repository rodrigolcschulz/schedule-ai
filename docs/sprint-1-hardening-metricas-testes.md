# Sprint 1 (Semanas 1-3): Hardening + Metricas + Testes de Conversa

Objetivo do sprint:
- Aumentar confiabilidade do fluxo plan -> execute -> reflect.
- Medir qualidade tecnica e qualidade de produto com indicadores objetivos.
- Validar comportamento conversacional com testes automatizados orientados a cenarios.

Definicao de pronto (DoD):
- Rastro ponta a ponta por requisicao com correlation id em logs.
- Erros padronizados e auditaveis no fluxo do agente.
- Endpoint de metricas tecnicas e de negocio para demonstracao.
- Suite de testes de conversa com cenarios happy path + edge cases.

---

## Milestones

### M1 - Hardening Basico (fim da semana 1)
- Correlation id propagado entre API e python-ai.
- Estrutura de erro padronizada em chat/agent.
- Logs estruturados por etapa com latencia.

### M2 - Metricas (fim da semana 2)
- Coleta em memoria de metricas por etapa (plan, execute, reflect).
- Indicadores de negocio (bookings, clarifications, falhas de tool).
- Endpoint GET /llm/metrics para acompanhamento.

### M3 - Testes de Conversa (fim da semana 3)
- Testes automatizados de cenarios conversacionais.
- Relatorio simples de taxa de aprovacao por suite.
- Documentacao de resultados no README e no sprint doc.

---

## Plano Diario (Dia 1 a Dia 15)

### Semana 1

Dia 1 - Baseline e observabilidade atual
- Levantar baseline de latencia e falhas no fluxo atual.
- Mapear pontos de log em API e python-ai.
- Definir padrao de log estruturado (campos obrigatorios).

Aceite:
- Baseline registrado no PR com tabela simples (manual inicial).

Dia 2 - Correlation ID
- Gerar correlation id na API quando ausente.
- Propagar via cabecalho para python-ai.
- Incluir correlation id em todos os logs do pipeline.

Aceite:
- Uma conversa completa mostra o mesmo correlation id de ponta a ponta.

Dia 3 - Padronizacao de erros
- Definir payload de erro no /llm/chat e /llm/chat/agent.
- Classificar erros: validation_error, upstream_ai_error, tool_execution_error, internal_error.
- Garantir mensagens amigaveis para cliente e detalhes tecnicos em log.

Aceite:
- Erros equivalentes retornam mesmo formato e codigo HTTP previsivel.

Dia 4 - Telemetria por etapa
- Medir duracao de plan, execute e reflect separadamente.
- Logar nome da tool, sucesso/falha e tempo da tool.
- Adicionar contador simples por tipo de erro.

Aceite:
- Cada chamada de /llm/chat/agent gera evento com tempos por etapa.

Dia 5 - Hardening review
- Revisar pontos de timeout e retry no ai-client.
- Definir timeout por endpoint (plan e reflect) e fallback consistente.
- Fechar milestone M1.

Aceite:
- PR M1 com evidencias de logs e casos de falha controlada.

### Semana 2

Dia 6 - Modelo de metricas
- Definir estrutura de metricas em memoria (contadores e histogramas simples).
- Separar metricas tecnicas e de negocio.

Aceite:
- Estrutura implementada e atualizada no fluxo principal.

Dia 7 - Metricas tecnicas
- total_requests
- plan_success_rate
- reflect_approved_rate
- tool_error_rate
- latency_ms p50/p95 para plan e reflect

Aceite:
- Valores retornam coerentes apos execucao de cenarios manuais.

Dia 8 - Metricas de negocio
- booking_success_count
- booking_failure_count
- cancel_success_count
- clarification_rate
- services_intent_count

Aceite:
- Conversas de booking/cancel/services incrementam contadores corretos.

Dia 9 - Endpoint de metricas
- Criar GET /llm/metrics na API.
- Expor timestamp de reset e uptime.
- Incluir resumo pronto para leitura humana.

Aceite:
- Endpoint responde sem depender de frontend.

Dia 10 - Metricas review
- Validar consistencia dos indicadores com fluxo real.
- Adicionar secao de metricas no README.
- Fechar milestone M2.

Aceite:
- PR M2 com exemplo de output do endpoint e interpretacao minima.

### Semana 3

Dia 11 - Infra de testes
- Escolher framework de teste para API (Vitest recomendado).
- Criar scripts de teste no package.json raiz e api.
- Configurar ambiente minimo para testes do fluxo agent.

Aceite:
- Comando unico executa a suite localmente.

Dia 12 - Testes happy path
- Agendamento completo com dados validos.
- Consulta de agendamentos por telefone.
- Cancelamento com sucesso.

Aceite:
- Todos os cenarios happy path passam.

Dia 13 - Testes edge cases 1
- Confirmacao curta apos convite para agendar.
- Pergunta de servicos sem cair em fluxo de booking.
- Data sem horario deve pedir escolha de horario.

Aceite:
- Comportamento esperado reproduzido de forma deterministica.

Dia 14 - Testes edge cases 2
- Horario indisponivel com sugestao de alternativas.
- Falha de tool com fallback amigavel.
- Reset de contexto apos booking/cancel com sucesso.

Aceite:
- Falhas sao tratadas sem quebrar UX conversacional.

Dia 15 - Consolidacao
- Rodar suite completa e registrar taxa de aprovacao.
- Publicar relatorio simples no docs.
- Fechar milestone M3.

Aceite:
- Sprint concluido com DoD atendido e evidencias anexadas.

---

## Backlog de Issues (pronto para criar no GitHub)

### Epic
1. [S1] Hardening e Qualidade do Agente Conversacional

### Semana 1 - Hardening
1. [S1][HARDEN] Implementar correlation id ponta a ponta no fluxo API -> python-ai
2. [S1][HARDEN] Padronizar payload de erro em /llm/chat e /llm/chat/agent
3. [S1][HARDEN] Adicionar logs estruturados por etapa (plan, execute, reflect)
4. [S1][HARDEN] Configurar timeout/retry policy no ai-client

### Semana 2 - Metricas
1. [S1][METRICS] Implementar coletor de metricas em memoria
2. [S1][METRICS] Medir latencia p50/p95 de plan e reflect
3. [S1][METRICS] Adicionar metricas de negocio (booking, cancel, clarification)
4. [S1][METRICS] Criar endpoint GET /llm/metrics
5. [S1][DOCS] Documentar leitura das metricas no README

### Semana 3 - Testes
1. [S1][TEST] Configurar Vitest e scripts de teste na API
2. [S1][TEST] Criar suite de testes de conversa happy path
3. [S1][TEST] Criar suite de testes de edge cases conversacionais
4. [S1][TEST] Gerar relatorio de cobertura de cenarios

---

## Template de Issue

Titulo:
[S1][AREA] Descricao curta orientada a resultado

Descricao:
- Contexto:
- Objetivo:
- Escopo:
- Fora de escopo:

Checklist tecnico:
- [ ] Implementacao principal
- [ ] Logs e tratamento de erro
- [ ] Testes
- [ ] Documentacao

Criterios de aceite:
- [ ] Criterio 1
- [ ] Criterio 2
- [ ] Criterio 3

Evidencias esperadas:
- Link para PR
- Print/log de execucao
- Exemplo de request/response (quando aplicavel)

---

## Riscos e Mitigacoes

- Risco: testes conversacionais ficarem instaveis por dependencia de LLM.
  Mitigacao: usar doubles/mocks no provider para cenarios deterministas.

- Risco: metricas incorretas por ausencia de padrao de evento.
  Mitigacao: definir contrato unico de evento antes de instrumentar.

- Risco: excesso de alteracoes no mesmo PR.
  Mitigacao: PRs pequenos por milestone e validacao incremental.

---

## Indicadores de Sucesso do Sprint

- Reducao de falhas nao tratadas no chat/agent.
- Aumento da previsibilidade do fluxo em cenarios de erro.
- Evidencia objetiva de qualidade (metricas + testes) para portfolio e entrevistas.

---

## Baseline Semana 1 (captura inicial)

Comandos sugeridos para coletar baseline:

```powershell
# gerar 10 chamadas de conversa simples (ajuste payload conforme necessario)
1..10 | ForEach-Object {
  Invoke-RestMethod -Method Post -Uri "http://localhost:3001/llm/chat/agent" -ContentType "application/json" -Body (@{
    sessionId = "baseline-week1"
    messages = @(@{ role = "user"; content = "quero agendar uma consulta" })
  } | ConvertTo-Json -Depth 6)
}

# ler estatisticas de hardening
Invoke-RestMethod -Method Get -Uri "http://localhost:3001/llm/hardening/stats" | ConvertTo-Json -Depth 8
```

Tabela para preencher no PR:

| Medida | Valor inicial | Observacao |
|---|---:|---|
| total chamadas /llm/chat/agent | 10 | lote baseline local em 2026-07-20 |
| validation_error | 0 | sem payload invalido no lote |
| upstream_ai_error | 0 | python-ai acessivel durante medicao |
| tool_execution_error | 0 | nenhuma tool falhou no lote |
| internal_error | 0 | sem excecoes nao tratadas no endpoint |

## Status de Implementacao da Semana 1

- [x] Correlation id ponta a ponta (API -> python-ai)
- [x] Logs estruturados por etapa (plan, execute, reflect, total)
- [x] Padronizacao de erro nos endpoints de IA
- [x] Timeouts e retries configuraveis por ambiente
- [x] Contadores simples de erro por tipo em memoria
- [x] Endpoint tecnico de diagnostico: GET /llm/hardening/stats