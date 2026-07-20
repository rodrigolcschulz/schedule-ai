// services/ai-client.ts
// Cliente HTTP para o serviço python-ai (FastAPI), rodando ao lado do Fastify.
// Espelha os contratos definidos em contracts/planner.py.

import type { ToolDefinition } from "../domains/types.js";

export type { ToolDefinition };

const AI_BASE_URL = process.env.AI_BASE_URL ?? "http://localhost:8001";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PlanStep {
  id: string;
  title: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
}

export interface PlannerRequest {
  message: string;
  history: ChatMessage[];
  domainId: string;
  sessionId: string;
}

export interface PlannerResponse {
  version: string;
  domainId: string;
  summary: string;
  intent: string;
  confidence: number;
  needsClarification: boolean;
  missingFields: Array<{
    field: string;
    reason: string;
    question: string;
  }>;
  steps: PlanStep[];
  suggestedReply: string;
}

export interface ToolExecutionRecord {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface ExecuteResult {
  success: boolean;
  result: Record<string, unknown>;
  error?: string;
}

export interface ReflectRequest {
  plan: PlannerResponse;
  executeResult: ExecuteResult;
  sessionId?: string;
}

export interface ReflectResponse {
  version: string;
  approved: boolean;
  finalReply: string;
  insights: Array<Record<string, unknown>>;
}

export interface HealthResponse {
  status: string;
  provider: string;
}

export class AiClientError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "AiClientError";
  }
}

interface RequestOptions {
  correlationId?: string;
  timeoutMs?: number;
  retries?: number;
}

async function postJson<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retries = options.retries ?? 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (options.correlationId) {
        headers["x-correlation-id"] = options.correlationId;
      }

      const res = await fetch(`${AI_BASE_URL}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new AiClientError(`python-ai ${path} -> ${res.status}: ${text}`, res.status);
      }

      return (await res.json()) as T;
    } catch (err) {
      const normalizedError =
        err instanceof AiClientError
          ? err
          : new AiClientError(`Falha ao chamar python-ai ${path}: ${(err as Error).message}`);

      const isRetryable =
        !(normalizedError instanceof AiClientError && normalizedError.status !== undefined && normalizedError.status < 500);

      if (attempt < retries && isRetryable) {
        lastError = normalizedError;
        continue;
      }

      throw normalizedError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (lastError instanceof Error
    ? lastError
    : new AiClientError(`Falha ao chamar python-ai ${path}: erro desconhecido`));
}

async function deleteRequest(path: string, options: RequestOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {};
    if (options.correlationId) {
      headers["x-correlation-id"] = options.correlationId;
    }

    const res = await fetch(`${AI_BASE_URL}${path}`, {
      method: "DELETE",
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AiClientError(`python-ai ${path} -> ${res.status}: ${text}`, res.status);
    }
  } catch (err) {
    if (err instanceof AiClientError) throw err;
    throw new AiClientError(`Falha ao chamar python-ai ${path}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export const aiClient = {
  plan(req: PlannerRequest, options?: RequestOptions): Promise<PlannerResponse> {
    return postJson<PlannerResponse>("/ai/plan", {
      version: "1.0",
      domainId: req.domainId,
      message: req.message,
      sessionId: req.sessionId,
      history: req.history,
    }, options);
  },

  reflect(req: ReflectRequest, options?: RequestOptions): Promise<ReflectResponse> {
    return postJson<ReflectResponse>("/ai/reflect", req, options);
  },

  async health(): Promise<HealthResponse> {
    const res = await fetch(`${AI_BASE_URL}/ai/health`);
    if (!res.ok) {
      throw new AiClientError(`python-ai /ai/health -> ${res.status}`, res.status);
    }
    return res.json() as Promise<HealthResponse>;
  },

  clearMemory(sessionId: string, options?: RequestOptions): Promise<void> {
    return deleteRequest(`/ai/memory/${encodeURIComponent(sessionId)}`, options);
  },
};