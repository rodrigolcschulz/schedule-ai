import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { createWhatsAppProvider, type WhatsAppProviderKind } from "./whatsapp/factory.js";
import type { StubWhatsAppProvider } from "./whatsapp/stub-provider.js";
import { dentalDomain } from "./domains/dental/index.js";
import type { DomainContext } from "./domains/types.js";
import { runAgent } from "./services/run-agent.js";
import { aiClient, AiClientError, type ToolExecutionRecord } from "./services/ai-client.js";
import { createNotificationAgent } from "./services/notification-agent.js";
import type { PatientStore } from "./domains/dental/patient-store.js";

const domain = dentalDomain;
const ctx: DomainContext = domain.createContext();

console.info(`[domain] Active domain: ${domain.displayName} (${domain.id})`);

function envProviderKind(): WhatsAppProviderKind {
  const v = (process.env.WHATSAPP_PROVIDER ?? "stub").toLowerCase();
  if (v === "cloud") return "cloud";
  if (v === "baileys") return "baileys";
  return "stub";
}

const wa = createWhatsAppProvider(envProviderKind());
const notificationAgent = createNotificationAgent(wa);

const maybePatients = (ctx as { patients?: PatientStore }).patients;
if (maybePatients) {
  maybePatients.setOnAppointmentCreated(async (appointment) => {
    await notificationAgent.notifyAppointmentCreated(appointment);
  });
}

wa.onMessage(async (msg) => {
  const text = msg.text.trim();
  const lower = text.toLowerCase();

  try {
    if (lower === "ajuda" || lower === "help") {
      await wa.sendText(msg.from, domain.whatsAppHelp);
      return;
    }

    const directReply = await domain.handleWhatsAppCommand?.(text, lower, msg.from, ctx);
    if (directReply) {
      await wa.sendText(msg.from, directReply);
      return;
    }

    const reply = await runAgent(domain, text, [], `wa:${msg.from}`, ctx);
    await wa.sendText(msg.from, reply);
  } catch (err) {
    console.error("[whatsapp] failed to process message", err);
    await wa.sendText(msg.from, "Desculpe, não consegui processar agora. Pode tentar novamente?");
  }
});

wa.onStatusUpdate?.((status) => {
  console.info("[whatsapp] status update", {
    status: status.status,
    messageId: status.messageId,
    recipientId: status.recipientId,
    timestamp: status.timestamp,
    conversationId: status.conversationId,
    pricingCategory: status.pricingCategory,
  });
});

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.addHook("onRequest", async (req, reply) => {
  const incomingCorrelationId = req.headers["x-correlation-id"];
  const correlationId =
    typeof incomingCorrelationId === "string" && incomingCorrelationId.trim().length > 0
      ? incomingCorrelationId.trim()
      : req.id;

  req.correlationId = correlationId;
  reply.header("x-correlation-id", correlationId);
});

type ApiErrorType = "validation_error" | "upstream_ai_error" | "tool_execution_error" | "internal_error";

const PLAN_TIMEOUT_MS = Number(process.env.AI_PLAN_TIMEOUT_MS ?? 12_000);
const REFLECT_TIMEOUT_MS = Number(process.env.AI_REFLECT_TIMEOUT_MS ?? 12_000);
const AI_RETRIES = Number(process.env.AI_HTTP_RETRIES ?? 1);

const hardeningStats = {
  startedAt: new Date().toISOString(),
  requests: {
    llmChat: 0,
    llmChatAgent: 0,
    llmPlanner: 0,
  },
  errorsByType: {
    validation_error: 0,
    upstream_ai_error: 0,
    tool_execution_error: 0,
    internal_error: 0,
  } as Record<ApiErrorType, number>,
};

function markError(type: ApiErrorType) {
  hardeningStats.errorsByType[type] += 1;
}

function sendApiError(
  req: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  type: ApiErrorType,
  message: string,
  detail?: string,
) {
  markError(type);
  req.log.error(
    {
      event: "api.error",
      correlationId: req.correlationId,
      errorType: type,
      statusCode,
      detail,
    },
    message,
  );

  return reply.code(statusCode).send({
    error: {
      type,
      message,
      correlationId: req.correlationId,
    },
  });
}

app.get("/llm/hardening/stats", async () => {
  const startedAt = new Date(hardeningStats.startedAt).getTime();
  const uptimeMs = Math.max(0, Date.now() - startedAt);

  return {
    startedAt: hardeningStats.startedAt,
    uptimeMs,
    timeouts: {
      planTimeoutMs: PLAN_TIMEOUT_MS,
      reflectTimeoutMs: REFLECT_TIMEOUT_MS,
      retries: AI_RETRIES,
    },
    requests: hardeningStats.requests,
    errorsByType: hardeningStats.errorsByType,
  };
});

app.get("/health", async () => ({ ok: true }));

app.get("/domain", async () => ({
  id: domain.id,
  displayName: domain.displayName,
  tools: domain.tools.map((t) => t.function.name),
}));

app.get("/catalog", async () => {
  const { servicesPayloadForApi } = await import("./domains/dental/catalog.js");
  return servicesPayloadForApi();
});

app.get("/menu", async (_req, reply) => {
  return reply.code(404).send({ error: "not_available_for_this_domain" });
});

app.get("/orders", async (_req, reply) => {
  return reply.code(404).send({ error: "not_available_for_this_domain" });
});

app.get("/slots", async (req) => {
  const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
  const slots = ctx.schedule.getSlotsForDay(q.date);
  const taken = await ctx.schedule.getBookedSlotIds();
  return {
    date: q.date,
    slots: slots.map((s) => ({ ...s, available: !taken.has(s.id) })),
  };
});

const createBookingBody = z.object({
  slotId: z.string(),
  customerName: z.string().min(1),
  phone: z.string().min(3),
  serviceId: z.string().optional(),
  notes: z.string().optional(),
});

app.post("/bookings", async (req, reply) => {
  const body = createBookingBody.parse(req.body);
  const slots = ctx.schedule.getSlotsForDay(body.slotId.slice(0, 10));
  const slot = slots.find((s) => s.id === body.slotId);
  if (!slot) return reply.code(400).send({ error: "invalid_slot" });

  const { patients } = ctx as unknown as { patients: import("./domains/dental/patient-store.js").PatientStore };

  if (body.serviceId) {
    const res = await patients.createAppointment(ctx.schedule, {
      slotId: slot.id,
      patientName: body.customerName,
      phone: body.phone.replace(/\D/g, "") || body.phone,
      serviceId: body.serviceId,
      ...(body.notes ? { notes: body.notes } : {}),
    });
    if ("error" in res) return reply.code(409).send({ error: res.error });
    return res;
  }

  const res = await ctx.schedule.createBooking({
    slotId: slot.id,
    startsAt: slot.startsAt,
    customerName: body.customerName,
    phone: body.phone.replace(/\D/g, "") || body.phone,
  });
  if ("error" in res) return reply.code(409).send({ error: res.error });
  return res;
});

app.get("/bookings", async () => ctx.schedule.listBookings());

app.delete<{ Params: { id: string } }>("/bookings/:id", async (req, reply) => {
  const ok = await ctx.schedule.cancelBooking(req.params.id);
  if (!ok) return reply.code(404).send({ error: "not_found" });
  return { ok: true };
});

app.get("/appointments", async (req) => {
  const { patients } = ctx as unknown as { patients: import("./domains/dental/patient-store.js").PatientStore };
  const q = z.object({ phone: z.string().optional() }).parse(req.query);
  const list = q.phone ? await patients.listAppointmentsByPhone(q.phone) : await patients.listAll();
  return { appointments: list };
});

const simulateBody = z.object({
  from: z.string().min(3),
  text: z.string().min(1),
});

app.post("/integrations/whatsapp/simulate-inbound", async (req, reply) => {
  if (wa.name !== "stub") return reply.code(400).send({ error: "only_stub" });
  const body = simulateBody.parse(req.body);
  (wa as StubWhatsAppProvider).simulateInbound({ from: body.from, text: body.text });
  return { ok: true };
});

app.post("/integrations/whatsapp/webhook", async (req) => {
  if (wa.handleWebhookPayload) {
    wa.handleWebhookPayload(req.body);
    return { ok: true };
  }

  req.log.info({ body: req.body }, "whatsapp webhook (provider sem parser de payload)");
  return { ok: true };
});

app.get("/integrations/whatsapp/webhook", async (req, reply) => {
  if (!wa.verifyWebhook) {
    return reply.code(404).send({ error: "verify_not_supported" });
  }

  const challenge = wa.verifyWebhook(req.query as Record<string, unknown>);
  if (!challenge) {
    return reply.code(403).send({ error: "invalid_verify_token" });
  }

  return reply.type("text/plain").send(challenge);
});

const llmChatBody = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) })).min(1),
  sessionId: z.string().min(1).optional(),
});

app.get("/llm/status", async () => {
  try {
    const health = await aiClient.health();
    const provider = health.provider;
    const providerInfo =
      typeof provider === "object" && provider !== null
        ? (provider as Record<string, unknown>)
        : {};
    const model =
      typeof providerInfo.model === "string"
        ? providerInfo.model
        : "unknown";
    const models = Array.isArray(providerInfo.models)
      ? (providerInfo.models as string[])
      : [];
    const ollamaReachable =
      typeof providerInfo.available === "boolean"
        ? providerInfo.available
        : true;
    const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";

    return {
      model,
      ollamaUrl,
      ollamaReachable,
      models,
      aiBackend: "python",
      aiBaseUrl: process.env.AI_BASE_URL ?? "http://localhost:8001",
      pythonAiReachable: true,
      provider,
      status: health.status,
    };
  } catch (e) {
    return {
      model: "unknown",
      ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
      ollamaReachable: false,
      models: [],
      aiBackend: "python",
      aiBaseUrl: process.env.AI_BASE_URL ?? "http://localhost:8001",
      pythonAiReachable: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
});

app.get("/llm/tools", async () => ({
  domain: domain.id,
  tools: domain.tools,
  hint: "POST /llm/tools/invoke com { tool, arguments } para testar tools; POST /llm/chat/agent para fluxo completo.",
}));

app.delete("/llm/memory/:sessionId", async (req, reply) => {
  const params = z.object({ sessionId: z.string().min(1) }).parse(req.params);
  try {
    await aiClient.clearMemory(params.sessionId, {
      correlationId: req.correlationId,
      timeoutMs: 10_000,
    });
    return { ok: true, sessionId: params.sessionId };
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({ error: "python_ai_error", detail: e instanceof Error ? e.message : String(e) });
  }
});

const toolInvokeBody = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.any()).optional().default({}),
});

app.post("/llm/tools/invoke", async (req, reply) => {
  const body = toolInvokeBody.parse(req.body);
  const result = await domain.executeTool(body.tool, body.arguments, ctx);
  if (!result.ok) return reply.code(400).send({ error: result.error });
  return { tool: body.tool, result: result.result };
});

const plannerBody = z.object({
  message: z.string().min(1),
  phone: z.string().optional(),
});

app.post("/llm/planner", async (req, reply) => {
  hardeningStats.requests.llmPlanner += 1;
  try {
    const body = plannerBody.parse(req.body);
    const plan = await aiClient.plan({
      message: body.message,
      history: [],
      domainId: domain.id,
      sessionId: body.phone ?? "planner-session",
    }, {
      correlationId: req.correlationId,
      timeoutMs: PLAN_TIMEOUT_MS,
      retries: AI_RETRIES,
    });
    return { plan };
  } catch (e) {
    if (e instanceof z.ZodError) {
      return sendApiError(req, reply, 400, "validation_error", "Payload invalido para /llm/planner", e.message);
    }
    if (e instanceof AiClientError) {
      return sendApiError(req, reply, 502, "upstream_ai_error", "Falha ao consultar planner de IA", e.message);
    }
    return sendApiError(req, reply, 500, "internal_error", "Erro interno ao processar /llm/planner", e instanceof Error ? e.message : String(e));
  }
});

async function executePlanSteps(
  req: FastifyRequest,
  steps: Array<{ toolName: string; toolArgs: Record<string, unknown> }>
): Promise<ToolExecutionRecord[]> {
  const toolResults: ToolExecutionRecord[] = [];

  for (const step of steps) {
    const toolStarted = performance.now();
    try {
      const outcome = await domain.executeTool(step.toolName, step.toolArgs, ctx);
      const elapsedMs = Number((performance.now() - toolStarted).toFixed(2));
      toolResults.push({
        tool: step.toolName,
        args: step.toolArgs,
        result: outcome.ok ? outcome.result : { error: outcome.error },
      });
      req.log.info(
        {
          event: "agent.execute.tool",
          correlationId: req.correlationId,
          toolName: step.toolName,
          success: outcome.ok,
          elapsedMs,
        },
        "Tool execution finished",
      );
    } catch (err) {
      const elapsedMs = Number((performance.now() - toolStarted).toFixed(2));
      toolResults.push({
        tool: step.toolName,
        args: step.toolArgs,
        result: { error: err instanceof Error ? err.message : "execute_failed" },
      });
      req.log.error(
        {
          event: "agent.execute.tool",
          correlationId: req.correlationId,
          toolName: step.toolName,
          success: false,
          elapsedMs,
        },
        "Tool execution failed",
      );
    }
  }

  return toolResults;
}

app.post("/llm/chat", async (req, reply) => {
  hardeningStats.requests.llmChat += 1;
  const started = performance.now();
  try {
    const body = llmChatBody.parse(req.body);
    const lastUserMessage = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const sessionId = body.sessionId ?? "web-session";
    const out = await runAgent(domain, lastUserMessage, body.messages, sessionId, ctx, req.correlationId);
    req.log.info(
      {
        event: "agent.total",
        correlationId: req.correlationId,
        endpoint: "/llm/chat",
        elapsedMs: Number((performance.now() - started).toFixed(2)),
      },
      "Agent flow finished",
    );
    return { reply: out };
  } catch (e) {
    if (e instanceof z.ZodError) {
      return sendApiError(req, reply, 400, "validation_error", "Payload invalido para /llm/chat", e.message);
    }
    if (e instanceof AiClientError) {
      return sendApiError(req, reply, 502, "upstream_ai_error", "Falha ao consultar servico de IA", e.message);
    }
    return sendApiError(req, reply, 500, "internal_error", "Erro interno ao processar /llm/chat", e instanceof Error ? e.message : String(e));
  }
});

app.post("/llm/chat/agent", async (req, reply) => {
  hardeningStats.requests.llmChatAgent += 1;
  const totalStarted = performance.now();
  try {
    const body = llmChatBody.parse(req.body);
    const lastUserMessage = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const sessionId = body.sessionId ?? "web-session";

    const planStarted = performance.now();
    const plan = await aiClient.plan({
      message: lastUserMessage,
      history: body.messages,
      domainId: domain.id,
      sessionId,
    }, {
      correlationId: req.correlationId,
      timeoutMs: PLAN_TIMEOUT_MS,
      retries: AI_RETRIES,
    });
    const planElapsed = Number((performance.now() - planStarted).toFixed(2));
    req.log.info(
      {
        event: "agent.plan",
        correlationId: req.correlationId,
        intent: plan.intent,
        needsClarification: plan.needsClarification,
        missingFields: plan.missingFields.length,
        elapsedMs: planElapsed,
      },
      "Plan stage finished",
    );

    if (plan.needsClarification || plan.missingFields.length > 0) {
      req.log.info(
        {
          event: "agent.total",
          correlationId: req.correlationId,
          endpoint: "/llm/chat/agent",
          status: "clarification",
          elapsedMs: Number((performance.now() - totalStarted).toFixed(2)),
        },
        "Agent flow finished",
      );
      return { reply: plan.suggestedReply, trace: [], plan };
    }

    const executeStarted = performance.now();
    const toolResults = await executePlanSteps(
      req,
      plan.steps.map((s) => ({ toolName: s.toolName, toolArgs: s.toolArgs }))
    );
    const executeElapsed = Number((performance.now() - executeStarted).toFixed(2));
    req.log.info(
      {
        event: "agent.execute",
        correlationId: req.correlationId,
        steps: plan.steps.length,
        elapsedMs: executeElapsed,
      },
      "Execute stage finished",
    );

    const hasToolError = toolResults.some(
      (entry) =>
        typeof entry.result === "object" &&
        entry.result !== null &&
        "error" in (entry.result as Record<string, unknown>)
    );

    if (hasToolError) {
      markError("tool_execution_error");
      req.log.warn(
        {
          event: "agent.execute.error",
          correlationId: req.correlationId,
          errors: toolResults
            .filter(
              (entry) =>
                typeof entry.result === "object" &&
                entry.result !== null &&
                "error" in (entry.result as Record<string, unknown>)
            )
            .length,
        },
        "Tool execution returned one or more errors",
      );
    }

    const reflectStarted = performance.now();
    const reflected = await aiClient.reflect({
      plan,
      executeResult: {
        success: !hasToolError,
        result: { toolResults },
        ...(hasToolError ? { error: "tool_execution_failed" } : {}),
      },
      sessionId,
    }, {
      correlationId: req.correlationId,
      timeoutMs: REFLECT_TIMEOUT_MS,
      retries: AI_RETRIES,
    });
    const reflectElapsed = Number((performance.now() - reflectStarted).toFixed(2));
    req.log.info(
      {
        event: "agent.reflect",
        correlationId: req.correlationId,
        approved: reflected.approved,
        elapsedMs: reflectElapsed,
      },
      "Reflect stage finished",
    );

    if (!reflected.approved) {
      req.log.warn(
        {
          event: "agent.total",
          correlationId: req.correlationId,
          endpoint: "/llm/chat/agent",
          status: "not_approved",
          elapsedMs: Number((performance.now() - totalStarted).toFixed(2)),
        },
        "Agent flow finished with non approved reflection",
      );
      return {
        reply: "Desculpe, não consegui processar sua solicitação agora. Pode tentar de outro jeito?",
        trace: toolResults,
        plan,
      };
    }

    req.log.info(
      {
        event: "agent.total",
        correlationId: req.correlationId,
        endpoint: "/llm/chat/agent",
        status: "ok",
        elapsedMs: Number((performance.now() - totalStarted).toFixed(2)),
      },
      "Agent flow finished",
    );

    return { reply: reflected.finalReply, trace: toolResults, plan };
  } catch (e) {
    if (e instanceof z.ZodError) {
      return sendApiError(req, reply, 400, "validation_error", "Payload invalido para /llm/chat/agent", e.message);
    }
    if (e instanceof AiClientError) {
      return sendApiError(req, reply, 502, "upstream_ai_error", "Falha ao consultar servico de IA", e.message);
    }
    return sendApiError(req, reply, 500, "internal_error", "Erro interno ao processar /llm/chat/agent", e instanceof Error ? e.message : String(e));
  }
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

await wa.start();
await app.listen({ port, host });
console.info(`API http://${host}:${port} — domain: ${domain.id}`);
