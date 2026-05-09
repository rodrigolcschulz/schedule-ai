import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { createWhatsAppProvider, type WhatsAppProviderKind } from "./whatsapp/factory.js";
import type { StubWhatsAppProvider } from "./whatsapp/stub-provider.js";
import { attachDomainWhatsAppBot } from "./services/whatsapp-bot.js";
import {
  getOllamaBaseUrl,
  getOllamaModel,
  ollamaChat,
  ollamaTags,
} from "./services/ollama-chat.js";
import { runLlmToolAgent } from "./services/llm-agent.js";
import { dentalDomain } from "./domains/dental/index.js";
import { pizzeriaDomain } from "./domains/pizzeria/index.js";
import type { BusinessDomain, DomainContext } from "./domains/types.js";

// ── Domain selection ──────────────────────────────────────────────────────────
const DOMAIN_REGISTRY: Record<string, BusinessDomain> = {
  dental: dentalDomain,
  pizzeria: pizzeriaDomain,
};

const domainId = (process.env.BUSINESS_DOMAIN ?? "dental").toLowerCase();
const domain: BusinessDomain = DOMAIN_REGISTRY[domainId] ?? dentalDomain;
const ctx: DomainContext = domain.createContext();

console.info(`[domain] Active domain: ${domain.displayName} (${domain.id})`);

// ── WhatsApp ──────────────────────────────────────────────────────────────────
function envProviderKind(): WhatsAppProviderKind {
  const v = (process.env.WHATSAPP_PROVIDER ?? "stub").toLowerCase();
  if (v === "baileys") return "baileys";
  return "stub";
}

const wa = createWhatsAppProvider(envProviderKind());
attachDomainWhatsAppBot(wa, domain, ctx, { useLlmFallback: true });

// ── Fastify ───────────────────────────────────────────────────────────────────
const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

// ── Domain info ───────────────────────────────────────────────────────────────
app.get("/domain", async () => ({
  id: domain.id,
  displayName: domain.displayName,
  tools: domain.tools.map((t) => t.function.name),
}));

// ── Catalog / services ────────────────────────────────────────────────────────
// Each domain exposes its catalog via GET /catalog (generic) or legacy routes.
app.get("/catalog", async () => {
  if (domain.id === "dental") {
    const { servicesPayloadForApi } = await import("./domains/dental/catalog.js");
    return servicesPayloadForApi();
  }
  if (domain.id === "pizzeria") {
    const { menuPayloadForApi } = await import("./services/pizzeria-catalog.js");
    return menuPayloadForApi();
  }
  return { items: [] };
});

// Legacy: /menu (pizzeria) still works when domain=pizzeria
app.get("/menu", async (_req, reply) => {
  if (domain.id !== "pizzeria") return reply.code(404).send({ error: "not_available_for_this_domain" });
  const { menuPayloadForApi } = await import("./services/pizzeria-catalog.js");
  return menuPayloadForApi();
});

// Legacy: /orders (pizzeria)
app.get("/orders", async (_req, reply) => {
  if (domain.id !== "pizzeria") return reply.code(404).send({ error: "not_available_for_this_domain" });
  const { orders } = ctx as unknown as { orders: import("./services/order-store.js").OrderStore };
  return orders.listOrders();
});

// ── Slots & bookings ──────────────────────────────────────────────────────────
app.get("/slots", async (req) => {
  const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
  const slots = ctx.schedule.getSlotsForDay(q.date);
  const taken = ctx.schedule.getBookedSlotIds();
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

  // If dental domain and serviceId provided, delegate to PatientStore
  if (domain.id === "dental" && body.serviceId) {
    const { patients } = ctx as unknown as { patients: import("./domains/dental/patient-store.js").PatientStore };
    const res = patients.createAppointment(ctx.schedule, {
      slotId: slot.id,
      patientName: body.customerName,
      phone: body.phone.replace(/\D/g, "") || body.phone,
      serviceId: body.serviceId,
      ...(body.notes ? { notes: body.notes } : {}),
    });
    if ("error" in res) return reply.code(409).send({ error: res.error });
    return res;
  }

  const res = ctx.schedule.createBooking({
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
  const ok = ctx.schedule.cancelBooking(req.params.id);
  if (!ok) return reply.code(404).send({ error: "not_found" });
  return { ok: true };
});

// Dental-specific: list appointments for a patient
app.get("/appointments", async (req, reply) => {
  if (domain.id !== "dental") return reply.code(404).send({ error: "not_available_for_this_domain" });
  const { patients } = ctx as unknown as { patients: import("./domains/dental/patient-store.js").PatientStore };
  const q = z.object({ phone: z.string().optional() }).parse(req.query);
  const list = q.phone
    ? patients.listAppointmentsByPhone(q.phone)
    : patients.listAll();
  return { appointments: list };
});

// ── WhatsApp simulation ───────────────────────────────────────────────────────
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
  req.log.info({ body: req.body }, "whatsapp webhook (não processado no MVP)");
  return { ok: true };
});

// ── LLM ───────────────────────────────────────────────────────────────────────
const llmSystemPrompt =
  process.env.LLM_SYSTEM_PROMPT ?? domain.systemPrompt;

const llmChatBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) }))
    .min(1),
});

app.get("/llm/status", async () => {
  const tags = await ollamaTags();
  return {
    model: getOllamaModel(),
    ollamaUrl: getOllamaBaseUrl(),
    ollamaReachable: tags.ok,
    models: tags.names,
  };
});

app.post("/llm/chat", async (req, reply) => {
  const body = llmChatBody.parse(req.body);
  try {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: llmSystemPrompt },
      ...body.messages,
    ];
    const text = await ollamaChat(messages);
    return { reply: text };
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({ error: "ollama_error", detail: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/llm/tools", async () => ({
  domain: domain.id,
  tools: domain.tools,
  hint: "POST /llm/tools/invoke com { tool, arguments } para testar sem LLM; POST /llm/chat/agent para agente com Ollama.",
}));

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

app.post("/llm/chat/agent", async (req, reply) => {
  const body = llmChatBody.parse(req.body);
  try {
    const out = await runLlmToolAgent(body.messages, {
      systemPrompt: domain.systemPrompt,
      tools: domain.tools,
      executeTool: (name, args) => domain.executeTool(name, args, ctx),
    });
    return { reply: out.reply, trace: out.trace };
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({ error: "ollama_agent_error", detail: e instanceof Error ? e.message : String(e) });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

await wa.start();
await app.listen({ port, host });
console.info(`API http://${host}:${port} — domain: ${domain.id}`);

