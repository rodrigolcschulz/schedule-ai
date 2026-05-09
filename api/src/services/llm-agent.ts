import { getOllamaBaseUrl, getOllamaModel } from "./ollama-chat.js";
import type { OllamaToolDefinition } from "./llm-tools.js";
import {
  executeLlmTool,
  LLM_TOOLS,
  type ToolContext,
} from "./llm-tools.js";

export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * Opções para o agente domain-agnostic.
 * Quando omitidas, recaem no comportamento legado (pizzeria).
 */
export type AgentOptions = {
  systemPrompt?: string;
  tools?: OllamaToolDefinition[];
  executeTool?: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
};

type OllamaMsg = Record<string, unknown>;

function parseToolArguments(
  raw: string | Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Uma rodada de chat com tools (sem stream). Retorna o JSON completo do Ollama.
 */
async function ollamaChatOnce(params: {
  messages: OllamaMsg[];
  tools: OllamaToolDefinition[];
}): Promise<{
  message?: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: string | Record<string, unknown> };
    }>;
  };
}> {
  const base = getOllamaBaseUrl();
  const model = getOllamaModel();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: params.messages,
      tools: params.tools,
      stream: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama HTTP ${res.status}: ${t.slice(0, 600)}`);
  }
  return res.json() as Promise<{
    message?: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string | Record<string, unknown> };
      }>;
    };
  }>;
}

const AGENT_SYSTEM_DEFAULT =
  process.env.LLM_AGENT_SYSTEM_PROMPT ??
  [
    "Você é o assistente de uma pizzaria (demo). Use as ferramentas para consultar cardápio, horários à noite (Brasília), criar pedidos e agendamentos.",
    "Quando o usuário quiser pedir pizza ou marcar horário, chame as ferramentas em vez de inventar preços ou vagas.",
    "Telefone: pode normalizar só com dígitos.",
  ].join(" ");

const MAX_AGENT_STEPS = 8;

/**
 * Roda o agente LLM com tools.
 *
 * Assinatura legada (pizzeria):
 *   runLlmToolAgent(turns, ctx, systemPrompt?)
 *
 * Assinatura modular (qualquer domínio):
 *   runLlmToolAgent(turns, opts)
 *   onde opts = { systemPrompt, tools, executeTool }
 */
export async function runLlmToolAgent(
  turns: ChatTurn[],
  ctxOrOpts: ToolContext | AgentOptions,
  legacySystemPrompt?: string
): Promise<{ reply: string; trace?: Array<{ tool: string; ok: boolean }> }> {
  let systemPrompt: string;
  let activeTools: OllamaToolDefinition[];
  let execTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ ok: boolean; result?: unknown; error?: string }>;

  const isAgentOptions =
    ctxOrOpts &&
    ("tools" in ctxOrOpts || "executeTool" in ctxOrOpts || "systemPrompt" in ctxOrOpts) &&
    !("schedule" in ctxOrOpts);

  if (isAgentOptions) {
    const opts = ctxOrOpts as AgentOptions;
    systemPrompt = opts.systemPrompt ?? AGENT_SYSTEM_DEFAULT;
    activeTools = opts.tools ?? LLM_TOOLS;
    execTool = opts.executeTool ?? ((n, a) => executeLlmTool(n, a, { schedule: undefined as never, orders: undefined as never }));
  } else {
    const ctx = ctxOrOpts as ToolContext;
    systemPrompt = legacySystemPrompt ?? AGENT_SYSTEM_DEFAULT;
    activeTools = LLM_TOOLS;
    execTool = (n, a) => executeLlmTool(n, a, ctx);
  }

  const messages: OllamaMsg[] = [
    { role: "system", content: systemPrompt },
    ...turns.map((t) => ({ role: t.role, content: t.content })),
  ];
  const trace: Array<{ tool: string; ok: boolean }> = [];

  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    const data = await ollamaChatOnce({ messages, tools: activeTools });
    const msg = data.message;
    if (!msg) throw new Error("Resposta sem message do Ollama.");

    const toolCalls = msg.tool_calls?.filter(
      (tc) => tc.function?.name
    );
    if (!toolCalls?.length) {
      const text = msg.content?.trim() ?? "";
      return { reply: text || "(sem resposta textual)", trace };
    }

    messages.push(msg as OllamaMsg);

    for (const tc of toolCalls) {
      const fn = tc.function!;
      const name = fn.name!;
      const args = parseToolArguments(fn.arguments);
      const exec = await execTool(name, args);
      trace.push({ tool: name, ok: exec.ok });
      const payload = exec.ok ? exec.result : { error: exec.error };
      messages.push({
        role: "tool",
        content: JSON.stringify(payload),
      });
    }
  }

  return {
    reply:
      "Limite de passos do agente atingido. Tente simplificar o pedido ou atualize o Ollama.",
    trace,
  };
}
