# Demonstração : Engenharia de IA em Etapas

Este guia organiza uma apresentacao de demo para destacar competencias de Engenharia de IA no projeto schedule-ai, indo alem de um chat "que responde".

## Objetivo da narrativa

Demonstrar maturidade tecnica em cinco pilares:

- Orquestracao de agente com fluxo explicito (plan -> execute -> reflect).
- Confiabilidade (rules, guardrails, confirmacao antes de acao critica).
- Integracao com ferramentas de negocio (tool calling com contrato).
- Persistencia e consistencia de dados (Postgres sem quebrar API).
- Evolucao para canais e operacao (chat web, WhatsApp, MCP/analytics).

## Publico e posicionamento

Publico alvo principal:

- Tech leads e engenharia de produto com foco em IA aplicada.
- Recrutadores para vagas de AI Engineer / Software Engineer (AI).
- Fundadores e PMs que buscam times que entregam IA em producao.

Mensagem central:

"Nao e so prompt. E arquitetura de agente com controle, estado, regras e integracao real com sistema de negocio."

## Estrutura recomendada da serie

## Etapa 1 - Arquitetura end-to-end (contexto de produto)

### Objetivo de demonstracao

Provar que voce sabe desenhar um sistema de IA integrado, desacoplado e evolutivo.

### O que mostrar

- Fluxo completo: web -> API (Fastify/TS) -> python-ai (FastAPI) -> provider LLM.
- Separacao por camadas: dominio, planner, memoria, regras, guardrails, providers.
- Endpoints chave para interacao do agente.

### Evidencias no repo

- README.md
- api/src/index.ts
- python-ai/main.py

### Script de video (30 a 45s)

1. Mostrar diagrama da arquitetura.
2. Mostrar chamada do front para API e encaminhamento ao python-ai.
3. Mostrar resposta do agente voltando para o chat.

### Valor de Engenharia de IA

- Arquitetura clara para escalabilidade de dominio e providers.
- Evita acoplamento forte entre interface e inteligencia.

## Etapa 2 - "Cerebro" do agente (maior valor tecnico)

### Objetivo de demonstracao

Evidenciar controle de comportamento do agente, qualidade de decisao e robustez de entrada.

### O que mostrar

- Extracao de intencao e dados do paciente.
- Preenchimento progressivo de campos faltantes.
- Normalizacao de data/hora em pt-BR.
- Uso de memoria de sessao para evitar perguntas repetidas.
- Confirmacao explicita antes de criar/cancelar agendamento.

### Evidencias no repo

- python-ai/planner/llm_planner.py
- python-ai/rules/rules_engine.py
- python-ai/guardrails/guardrails.py
- python-ai/memory/memory_store.py

### Script de video (45 a 60s)

1. Usuario pede agendamento com informacao incompleta.
2. Agente pergunta apenas o proximo dado necessario.
3. Usuario informa data/horario em formato livre.
4. Mostrar normalizacao e plano montado com steps.

### Valor de Engenharia de IA

- Menos alucinacao por fluxo orientado a plano.
- Determinismo parcial com regras e guardrails.
- Melhor UX por perguntas objetivas e contexto de sessao.

## Etapa 3 - Tool calling e persistencia (prova de "producao")

### Objetivo de demonstracao

Mostrar que o agente executa acao de negocio real e persiste estado de forma confiavel.

### O que mostrar

- Sequencia em duas fases de booking:
  - listar horarios disponiveis;
  - criar agendamento apos escolha do horario.
- Persistencia de bookings/appointments no Postgres.
- Disponibilidade baseada em slot ocupado.
- Mesmos endpoints com backend memory ou postgres.

### Evidencias no repo

- docs/postgres-persistence.md
- api/sql/001_init_schedule.sql
- api/src/services/schedule-store.ts
- api/src/domains/dental/patient-store.ts
- api/src/services/pg.ts

### Script de video (45 a 60s)

1. Criar agendamento pelo chat.
2. Consultar registros no banco.
3. Repetir busca de slots e mostrar bloqueio de horario ocupado.

### Valor de Engenharia de IA

- Integracao IA + transacao de negocio.
- Consistencia de dados e contrato estavel de API.

## Etapa 4 - Canais e operacao (produto pronto para evoluir)

### Objetivo de demonstracao

Comprovar capacidade de levar o agente para interfaces reais e multicanal.

### O que mostrar

- Chat web funcionando ponta a ponta.
- Simulacao de inbound WhatsApp via provider stub.
- Plano de migracao para WhatsApp Cloud API oficial.

### Evidencias no repo

- web/src/pages/Chat.tsx
- api/src/whatsapp/stub-provider.ts
- api/src/whatsapp/factory.ts
- docs/plano-integracao-whatsapp.md

### Script de video (30 a 45s)

1. Mensagem no chat web.
2. Simular evento inbound WhatsApp.
3. Mostrar mesma logica de agente servindo canais diferentes.

### Valor de Engenharia de IA

- Reuso de nucleo de decisao em diferentes canais.
- Base para omnichannel sem duplicar inteligencia.

## Etapa 5 - Extensao opcional de alto impacto (MCP para analytics)

### Objetivo de demonstracao

Mostrar visao de plataforma de IA e observabilidade orientada a operacao.

### O que implementar (fase 2)

- MCP server para consultas operacionais:
  - total de agendamentos por periodo;
  - horarios mais solicitados;
  - taxa de conclusao por sessao;
  - cancelamentos por janela de tempo.
- Ferramentas de leitura segura (somente leitura no banco para demo).

### Demo sugerida

- Perguntar ao MCP: "quais horarios tem mais procura esta semana?"
- Retornar agregacao SQL em linguagem natural + tabela resumida.

### Valor de Engenharia de IA

- IA para operacao e tomada de decisao, nao so atendimento.
- Ponte entre agente transacional e inteligencia analitica.

## Roteiro de conteudo para LinkedIn

## Formato recomendado

- 1 post teaser (arquitetura e proposta).
- 4 posts tecnicos (um por etapa 1-4).
- 1 post de fechamento (licoes, trade-offs, proximos passos com MCP).

## Estrutura de cada post

1. Problema real em 1 frase.
2. Solucao tecnica em 2 a 3 bullets.
3. Video curto (45-90s) ou carrossel.
4. Evidencia no codigo (arquivo/endpoint).
5. Licao aprendida + proximo passo.

## Exemplo de hook

"Construi um agente de agendamento odontologico com plano estruturado, guardrails e persistencia real em Postgres."

## Provas tecnicas que mais geram credibilidade

- Mostrar JSON do plano (steps, missingFields, suggestedReply).
- Mostrar validacao de regra (exemplo de data invalida e resposta amigavel).
- Mostrar antes/depois da normalizacao de horario/data.
- Mostrar registro persistido apos confirmacao do usuario.
- Mostrar troca de backend memory -> postgres sem alterar API publica.

## Metricas simples para incluir

Mesmo em projeto de portifolio, inclua metricas basicas:

- Taxa de conclusao de agendamento por sessao.
- Numero medio de mensagens ate confirmar booking.
- Percentual de mensagens com dados normalizados com sucesso.
- Taxa de reuso de contexto (quantas perguntas foram evitadas por memoria).

## Checklist de gravacao

- Ambiente limpo (sessao de memoria resetada quando necessario).
- Script de demo definido para evitar improviso tecnico.
- Logs visiveis em uma janela secundaria (API/Python AI).
- Zoom em pontos-chave (plano, guardrail, persistencia).
- Encerramento com proximo passo claro (MCP + WhatsApp Cloud).

## Riscos comuns de demo e como evitar

- Risco: parecer apenas "chat bonitinho".
  - Mitigacao: enfatizar plano estruturado, regras e persistencia.

- Risco: focar demais em stack e pouco em decisao do agente.
  - Mitigacao: mostrar deliberacao (faltantes, confirmacao, execucao).

- Risco: prometer integracao nao finalizada.
  - Mitigacao: separar "entregue hoje" de "roadmap".

## Fechamento sugerido para ultimo post

"Mais do que integrar um LLM, o desafio foi projetar confiabilidade: estado de sessao, regras explicitas, guardrails e execucao segura de tools. O resultado e um agente util para operacao real e pronto para evoluir para analytics via MCP e canais oficiais."
