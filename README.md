# schedule-ai

AI Scheduling Assistant para atendimento conversacional e agendamento com tool calling.

Projeto de demo full-stack orientado a portfólio: API de negócio, serviço de IA desacoplado, UI web, integração WhatsApp stub e execução local com Ollama.

https://github.com/user-attachments/assets/c5f1a5b2-175f-463c-a21f-525f3aea1771

## Stack

- Fastify + TypeScript (API de domínio)
- React + Vite (frontend)
- FastAPI + Python (planner e orquestração de IA)
- Ollama (local) + adapter para OpenAI/Claude
- FSM interna (orquestração de estados)
- Docker Compose
- PostgreSQL (serviço pronto no compose para evolução de persistência)

## O que este projeto demonstra

- Memória de sessão para contexto de conversa (com backend em memória ou SQLite)
- Tool calling controlado por plano estruturado
- Agenda e disponibilidade de horários
- Confirmação de ações antes de executar fluxos críticos
- Logs de requisição no serviço Python e tracing básico no fluxo do agente
- Arquitetura para extensão de domínio (dental hoje, outros domínios amanhã)

## Arquitetura

```mermaid
flowchart LR
    W[Web React] --> A[API Fastify TypeScript]
    A --> P[Python AI FastAPI]
    P --> C[Planner Rules Guardrails Memory FSM]
    C --> L[Provider Adapter Ollama OpenAI Claude]
```

## Fluxo Plan-Execute-Reflect

Resumo visual do ciclo principal do agente:

- Plan: o Python AI interpreta a mensagem e monta o plano (intencao, campos faltantes e passos).
- Execute: a API Fastify executa as tools de dominio (slots, bookings, appointments) com regras de negocio.
- Reflect: o Python AI valida o resultado, aplica guardrails e devolve a resposta final.

```mermaid
flowchart LR
    U[Mensagem do usuario] --> P[Plan em /ai/plan]
    P -->|faltam dados| Q[Pergunta objetiva]
    P -->|plano completo| E[Execute no dominio Fastify]
    E --> R[Reflect em /ai/reflect]
    R --> A[Resposta final aprovada]
```

## Estrutura principal

```text
schedule-ai/
├── api/
├── web/
├── python-ai/
├── docs/
├── docker/
└── docker-compose.yml
```

## Documentação

- docs/engenharia-ia-conceitos.md
- docs/postgres-persistence.md
- docs/sprint-1-hardening-metricas-testes.md

## Endpoints principais

### API (3001)

- GET /health
- GET /domain
- GET /catalog
- GET /slots?date=YYYY-MM-DD
- POST /bookings
- GET /bookings
- DELETE /bookings/:id
- GET /appointments?phone=
- GET /llm/status
- GET /llm/tools
- POST /llm/tools/invoke
- POST /llm/planner
- POST /llm/chat
- POST /llm/chat/agent
- POST /integrations/whatsapp/simulate-inbound
- GET /integrations/whatsapp/webhook
- POST /integrations/whatsapp/webhook

### Python AI (8001)

- GET /ai/health
- POST /ai/plan
- POST /ai/execute
- POST /ai/reflect
- GET /ai/memory/{session_id}
- DELETE /ai/memory/{session_id}

## Rodando localmente

### Opção 1: execução manual (mais simples para desenvolvimento)

#### 1) Subir API + Web

```bash
npm install
npm run dev
```

#### 2) Subir python-ai

```bash
cd python-ai
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

#### 3) Garantir o Ollama disponível

O serviço de IA depende de um modelo local ou remoto acessível pelo python-ai.

```bash
ollama pull llama3.1
ollama serve
```

Se quiser testar o chat completo no ambiente local, o modelo precisa estar disponível em:

- `http://localhost:11434` (padrão do Ollama)

URLs de desenvolvimento:

- Web: http://localhost:5173
- API: http://localhost:3001
- Python AI: http://localhost:8001

### Opção 2: execução com Docker

O compose já sobe a API, o serviço Python, o frontend e o PostgreSQL.

```bash
docker compose up --build
```

Serviços:

- Web: http://localhost:8080
- API: http://localhost:3001
- Python AI: http://localhost:8001
- PostgreSQL: localhost:5432

> Observação: o compose não sobe o Ollama automaticamente como dependência principal. O python-ai precisa conseguir alcançar um endpoint do Ollama (por padrão, `http://localhost:11434` no host ou `http://host.docker.internal:11434` quando executado via Docker Desktop).

## Refresh de sessao e memoria (PowerShell)

Quando parecer que a conversa ficou "em cache", normalmente e memoria de sessao persistida no python-ai.

### Sessao web (chat no navegador)

No frontend, o `session_id` e um UUID salvo em `localStorage` (chave `schedule_ai_chat_session_id`).
Entao limpar `web-session` nao afeta o chat atual se ele estiver usando outro id.

Pelo backend API (recomendado):

```powershell
Invoke-RestMethod -Method Delete -Uri "http://localhost:3001/llm/memory/SEU_SESSION_ID"
```

Ou direto no python-ai:

```powershell
Invoke-RestMethod -Method Delete -Uri "http://localhost:8001/ai/memory/SEU_SESSION_ID"
```

Para obter o id atual no navegador (DevTools Console):

```js
localStorage.getItem("schedule_ai_chat_session_id")
```

Se preferir, use o botao **Novo atendimento** na UI do chat para limpar e iniciar sessao nova automaticamente.

Exemplo de verificacao do estado atual:

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:8001/ai/memory/SEU_SESSION_ID" | ConvertTo-Json -Depth 8
```

Exemplo de limpeza:

```powershell
Invoke-RestMethod -Method Delete -Uri "http://localhost:8001/ai/memory/SEU_SESSION_ID"
```

### Sessao WhatsApp por telefone

Formato do session_id: `wa:SEU_NUMERO`

Exemplo para 47999999999:

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:8001/ai/memory/wa%3A47999999999" | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Delete -Uri "http://localhost:8001/ai/memory/wa%3A47999999999"
```

### Rebuild quando houver alteracao de codigo

```bash
docker compose up -d --build python-ai api
```

Observacoes:

- Nao cole links formatados pelo editor (ex.: markdown/vscode). Use sempre URL HTTP pura no parametro `-Uri`.
- `docker compose down -v` apaga volumes (incluindo dados de banco e memoria sqlite). Use somente quando quiser reset total.

## Variáveis importantes

### API

- AI_BASE_URL (default: http://localhost:8001)
- AI_PLAN_TIMEOUT_MS (default: 12000)
- AI_REFLECT_TIMEOUT_MS (default: 12000)
- AI_HTTP_RETRIES (default: 1)
- BUSINESS_DOMAIN (default: dental)
- WHATSAPP_PROVIDER (default: stub)
- WHATSAPP_ACCESS_TOKEN (obrigatorio quando WHATSAPP_PROVIDER=cloud)
- WHATSAPP_PHONE_NUMBER_ID (obrigatorio quando WHATSAPP_PROVIDER=cloud)
- WHATSAPP_VERIFY_TOKEN (obrigatorio quando WHATSAPP_PROVIDER=cloud)
- WHATSAPP_GRAPH_API_VERSION (default: v20.0)
- WHATSAPP_NOTIFY_ON_BOOKING (default: true)
- SCHEDULE_PERSISTENCE (memory | postgres, default: memory)
- PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
- DATABASE_URL (opcional, alternativa aos PG*)

## Configurar webhook da Meta com ngrok (opcional)

Este fluxo é opcional e só é necessário quando você quiser testar webhooks do WhatsApp com a Meta. Ele não é obrigatório para usar o chat local, a API ou o frontend.

1. Suba a API local na porta 3001 com provedor cloud:

```powershell
cd api
$env:WHATSAPP_PROVIDER="cloud"
$env:WHATSAPP_ACCESS_TOKEN="SEU_ACCESS_TOKEN"
$env:WHATSAPP_PHONE_NUMBER_ID="SEU_PHONE_NUMBER_ID"
$env:WHATSAPP_VERIFY_TOKEN="SEU_TOKEN_DE_VERIFICACAO"
npm run dev
```

2. Em outro terminal, abra tunel HTTPS com ngrok free:

```powershell
ngrok http 3001
```

3. No painel Meta Developers > WhatsApp > Configuration > Webhooks:
- Callback URL: `https://SEU-SUBDOMINIO.ngrok-free.app/integrations/whatsapp/webhook`
- Verify token: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
- Clique em Verify and save
- Em Webhook fields, assine `messages`

4. Teste rapido da verificacao (deve retornar o challenge em texto puro quando token estiver correto):

```powershell
Invoke-WebRequest -Uri "https://SEU-SUBDOMINIO.ngrok-free.app/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=SEU_TOKEN_DE_VERIFICACAO&hub.challenge=12345"
```

5. Teste de evento no painel da Meta:
- Use Send test webhook no campo `messages`
- Verifique logs da API: mensagens recebidas e status (`sent`, `delivered`, `read`) sao aceitos no mesmo endpoint

Observacoes:
- Sem publicar o app, nao ha trafego de producao (somente testes permitidos pela Meta).
- Para mTLS em webhooks, configure proxy/reverse-proxy com certificado de cliente (ngrok free nao cobre esse requisito por padrao).

### python-ai

- LLM_PROVIDER (default: ollama)
- OLLAMA_URL (default: http://localhost:11434)
- OLLAMA_MODEL (default: llama3.1)
- MEMORY_BACKEND (memory | sqlite, default: memory)
- MEMORY_SQLITE_PATH (default: ./data/memory.db)

> Se o serviço Python estiver rodando em Docker, o Ollama precisa estar acessível a partir do container. Em ambientes Docker Desktop, isso normalmente significa usar `http://host.docker.internal:11434`.

## Fluxo do agente

1. API recebe mensagem em POST /llm/chat/agent.
2. Python AI gera plano em POST /ai/plan.
3. Se faltam dados, retorna pergunta objetiva para completar campos.
4. Se o plano está completo, API executa tools no domínio.
5. Python AI faz reflexão em POST /ai/reflect e devolve resposta final.

```mermaid
sequenceDiagram
    participant U as Usuario
    participant W as Web
    participant A as API Fastify
    participant P as Python AI
    participant D as Domain Tools

    U->>W: Envia mensagem
    W->>A: POST /llm/chat/agent
    A->>P: POST /ai/plan
    P-->>A: PlannerResponse

    alt Campos faltando
        A-->>W: suggestedReply (pergunta objetiva)
        W-->>U: Pedido de dado faltante
    else Plano completo
        A->>D: Executa tools do dominio
        D-->>A: Resultado
        A->>P: POST /ai/reflect
        P-->>A: Resposta final aprovada
        A-->>W: Mensagem final
        W-->>U: Entrega da resposta
    end
```

## Agenda e bookings no PostgreSQL

O projeto agora suporta persistencia de agenda/agendamentos no banco sem mudar endpoints.

Como funciona:

1. Os slots continuam sendo gerados por regra (seg-sex, 8h-17h).
2. O que vai para o banco e' booking/appointment.
3. A disponibilidade e' calculada por `slot_id` reservado no Postgres.
4. A API usa `SCHEDULE_PERSISTENCE=postgres` para ativar o modo banco.

Arquivos principais:

- api/src/services/schedule-store.ts
- api/src/domains/dental/patient-store.ts
- api/src/services/pg.ts
- api/sql/001_init_schedule.sql

### Precisa de carga SQL?

Nao obrigatoriamente. O sistema funciona sem seed. A tabela comeca vazia e os dados entram pelos endpoints/tools.

Use seed apenas para demo visual (ex.: preencher alguns agendamentos para video).

### Migration SQL

Existe uma migration inicial em:

- api/sql/001_init_schedule.sql

Ela cria as tabelas `bookings` e `appointments` com indices e constraints.

## Roadmap para destaque no LinkedIn

- Persistência de agenda e memória em PostgreSQL
- Telemetria com correlação de request_id entre API e python-ai
- Conector real de WhatsApp Cloud API (Meta)
- Painel de observabilidade e histórico de conversas
- Suporte MCP para ferramentas externas de calendário/CRM

## Licença

MIT (ver LICENSE)
