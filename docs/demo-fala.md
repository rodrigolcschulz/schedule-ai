# Doc de Fala para Video (1 a 2 minutos)

Este documento traz um roteiro falado, pronto para gravacao, focado em Engenharia de IA aplicada.

## Duracao recomendada

- Ideal: 1m20s a 1m50s.
- Maximo recomendado para este formato: 2m.
- Sim, 1 a 2 minutos e um tamanho excelente para LinkedIn quando ha demonstracao tecnica objetiva.

## Objetivo da fala

Passar tres mensagens em ordem:

1. Existe arquitetura e metodo, nao apenas prompt.
2. O agente toma decisao com controle e confiabilidade.
3. O fluxo gera efeito real no negocio (agendamento e persistencia).

## Script principal (aprox. 1m40s)

### 0s a 15s - Abertura

"Neste projeto eu construi um agente de agendamento odontologico com foco em Engenharia de IA aplicada. Nao e so um chat respondendo texto: ele planeja, executa tools de negocio e reflete o resultado antes de responder ao usuario."

### 15s a 35s - Arquitetura

"A arquitetura e separada em camadas: web em React, API em Fastify, e um servico Python para o nucleo de IA. Esse nucleo usa planner, regras, guardrails e memoria de sessao. Assim, eu consigo evoluir o comportamento do agente com previsibilidade e sem acoplamento forte com a interface."

### 35s a 65s - Plan

"Quando chega uma mensagem, o primeiro passo e plan. O agente identifica intencao, extrai os dados do paciente, detecta campos faltantes e monta um plano estruturado. Se faltar informacao, ele nao inventa: faz uma pergunta objetiva do proximo dado necessario."

### 65s a 95s - Execute

"Com o plano completo, vem o execute. Antes de qualquer acao critica, entram as validacoes de regras e guardrails. No booking, o fluxo ocorre em duas fases: primeiro lista horarios disponiveis, depois cria o agendamento somente apos a escolha do horario."

### 95s a 120s - Reflect + Prova

"No reflect, o sistema transforma o resultado tecnico em resposta clara para o paciente. E o principal: isso gera efeito real. O agendamento e persistido no banco, o slot fica ocupado e o mesmo horario nao aparece mais como disponivel. Esse foi o foco: confiabilidade de agente com impacto de negocio."

## Script curto (aprox. 55s a 70s)

"Eu construi um agente de agendamento com arquitetura de Engenharia de IA: web em React, API em Fastify e nucleo Python com planner, regras, guardrails e memoria. O fluxo e plan, execute e reflect. No plan, ele entende a intencao e pede so o dado faltante. No execute, valida regras e chama tools de negocio com seguranca. No reflect, responde de forma natural para o paciente. E nao para no chat: o agendamento e salvo no banco e o slot fica indisponivel depois da confirmacao. O objetivo foi sair de um demo de prompt para um agente confiavel, integrado e pronto para evolucao multicanal." 

## Direcao de gravacao (para soar natural)

- Fale em blocos curtos, sem correr.
- Mantenha 1 ideia por frase.
- Enquanto fala de arquitetura, deixe o diagrama na tela.
- Enquanto fala de plan/execute/reflect, mostre o fluxo no README.
- Enquanto fala de prova, mostre chat + banco na sequencia.

## Fechamento opcional (CTA de 1 frase)

"Se fizer sentido, no proximo video eu mostro a evolucao para analytics operacional com MCP, consultando metricas de agenda em linguagem natural." 

## Checklist rapido antes de gravar

- Sessao de memoria limpa para demo consistente.
- Caso de uso ensaiado com entradas curtas.
- Uma tomada mostrando IDE (arquitetura e fluxo).
- Uma tomada mostrando UX (chat fim a fim).
- Uma tomada mostrando prova de persistencia.
