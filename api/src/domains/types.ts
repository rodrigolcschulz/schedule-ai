import type { OllamaToolDefinition } from "../services/llm-tools.js";
import type { ScheduleStore } from "../services/schedule-store.js";

export type ToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

/**
 * Contexto genérico passado para executeTool e handleWhatsAppCommand.
 * Cada domínio pode adicionar suas próprias stores via index signature.
 */
export type DomainContext = {
  schedule: ScheduleStore;
  [key: string]: unknown;
};

/**
 * Contrato principal que cada domínio de negócio deve implementar.
 * Troque id + prompt + tools + catalog e você tem um novo verticale.
 */
export interface BusinessDomain {
  /** Identificador usado na env var BUSINESS_DOMAIN */
  id: string;
  displayName: string;

  /** Prompt de sistema injetado no agente LLM */
  systemPrompt: string;

  /** Definições de ferramentas enviadas ao Ollama no /api/chat */
  tools: OllamaToolDefinition[];

  /**
   * Executor chamado pelo agente LLM após o modelo decidir usar uma ferramenta.
   * Recebe o nome da ferramenta, os argumentos já parseados e o contexto do domínio.
   */
  executeTool(
    name: string,
    args: Record<string, unknown>,
    ctx: DomainContext
  ): Promise<ToolResult>;

  /** Cria as stores necessárias para o domínio (schedule + extras) */
  createContext(): DomainContext;

  /** Texto exibido no comando "ajuda" via WhatsApp */
  whatsAppHelp: string;

  /**
   * Handler de comandos textuais do WhatsApp específicos do domínio.
   * Retorna a string de resposta, ou null para passar para o agente LLM.
   */
  handleWhatsAppCommand?(
    text: string,
    lower: string,
    from: string,
    ctx: DomainContext
  ): Promise<string | null>;
}
