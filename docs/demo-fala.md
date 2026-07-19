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

"Fala pessoal! Sou Rodrigo Schulz, trabalho com IA e Dados, e vou apresentar a vocês a demonstração de um assistente de agendamento odontológico, com foco em Engenharia de IA aplicada. Não é só um chat respondendo texto: ele planeja, executa tools de negócio e reflete o resultado antes de responder ao usuário."

### 15s a 35s - Arquitetura

Apresenta pelo chat a demonstração.
"A arquitetura é separada em camadas: web em React, API em Fastify, e um serviço Python para o núcleo de IA. Esse núcleo usa planner, regras, guardrails e memória de sessao.

### 35s a 65s - Plan

"Quando chega uma mensagem, o primeiro passo é plan. O agente identifica intenção, extrai os dados do paciente, detecta campos faltantes e monta um plano estruturado. Se faltar informação, ele não inventa: faz uma pergunta objetiva do proximo dado necessario."

### 65s a 95s - Execute

"Com o plano completo, vem o execute. Antes de qualquer ação crítica, entram as validacoes de regras e guardrails. No booking, o fluxo ocorre em duas fases: primeiro lista horarios disponiveis, depois cria o agendamento somente apos a escolha do horario."

### 95s a 120s - Reflect + Prova

"No reflect, o sistema transforma o resultado técnico em resposta clara para o paciente. E o principal: isso gera efeito real. O agendamento é persistido no banco, o slot fica ocupado e o mesmo horário nao aparece mais como disponível. Esse foi o foco: confiabilidade de agente com impacto de negócio."

## Direção de gravação (para soar natural)

- Fale em blocos curtos, sem correr.
- Mantenha 1 ideia por frase.
- Enquanto fala de arquitetura, deixe o diagrama na tela.
- Enquanto fala de plan/execute/reflect, mostre o fluxo no README.
- Enquanto fala de prova, mostre chat + banco na sequencia.

## Checklist rapido antes de gravar

- Sessao de memoria limpa para demo consistente.
- Caso de uso ensaiado com entradas curtas.
- Uma tomada mostrando IDE (arquitetura e fluxo).
- Uma tomada mostrando UX (chat fim a fim).
- Uma tomada mostrando prova de persistencia.