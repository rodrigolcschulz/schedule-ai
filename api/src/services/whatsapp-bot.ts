import type { IncomingWhatsAppMessage, WhatsAppProvider } from "../whatsapp/types.js";
import { formatSlotTimeBr } from "./schedule-store.js";
import type { BusinessDomain, DomainContext } from "../domains/types.js";
import { runLlmToolAgent } from "./llm-agent.js";

/**
 * Bot genérico para qualquer domínio de negócio.
 *
 * Fluxo de mensagem:
 * 1. Comandos universais (ajuda, horarios, meus, cancelar)
 * 2. domain.handleWhatsAppCommand() — comandos específicos do domínio
 * 3. Agente LLM com as tools do domínio (fallback inteligente)
 */
export function attachDomainWhatsAppBot(
  wa: WhatsAppProvider,
  domain: BusinessDomain,
  ctx: DomainContext,
  opts: { useLlmFallback?: boolean } = {}
): void {
  wa.onMessage(async (msg: IncomingWhatsAppMessage) => {
    const from = msg.from.replace(/\D/g, "") || msg.from;
    const text = msg.text.trim();
    const lower = text.toLowerCase();

    if (!text) return;

    // ── Comando universal: ajuda ──────────────────────────────────────────────
    if (lower === "ajuda" || lower === "help") {
      await wa.sendText(from, domain.whatsAppHelp);
      return;
    }

    // ── Comando universal: horarios YYYY-MM-DD ────────────────────────────────
    if (lower.startsWith("horarios ")) {
      const date = text.slice("horarios ".length).trim();
      const slots = ctx.schedule.getSlotsForDay(date);
      const taken = ctx.schedule.getBookedSlotIds();
      const free = slots.filter((s) => !taken.has(s.id));
      if (free.length === 0) {
        await wa.sendText(from, `Sem horários livres em ${date} (ou data inválida).`);
        return;
      }
      const lines = free.map((s) => `• ${formatSlotTimeBr(s.startsAt)} (${s.id})`);
      await wa.sendText(from, `Horários livres ${date} (Brasília):\n${lines.join("\n")}`);
      return;
    }

    // ── Comando universal: meus agendamentos ─────────────────────────────────
    if (lower === "meus" || lower === "meus agendamentos") {
      const mine = ctx.schedule.listBookings().filter((b) => b.phone === from);
      if (mine.length === 0) {
        await wa.sendText(from, "Nenhum agendamento para este número.");
        return;
      }
      const lines = mine.map((b) => {
        const svcLabel = b.meta?.serviceName ? ` — ${b.meta.serviceName}` : "";
        return `• ${b.id.slice(0, 8)}… | ${formatSlotTimeBr(b.startsAt)}${svcLabel}`;
      });
      await wa.sendText(from, `Seus agendamentos:\n${lines.join("\n")}`);
      return;
    }

    // ── Comando universal: cancelar BOOKING_ID ────────────────────────────────
    if (lower.startsWith("cancelar ")) {
      const id = text.slice("cancelar ".length).trim();
      const booking = ctx.schedule.listBookings().find((b) => b.id === id || b.id.startsWith(id));
      if (!booking || booking.phone !== from) {
        await wa.sendText(from, "Agendamento não encontrado para este número.");
        return;
      }
      ctx.schedule.cancelBooking(booking.id);
      await wa.sendText(from, `Cancelado: ${booking.id.slice(0, 8)}…`);
      return;
    }

    // ── Handler específico do domínio ─────────────────────────────────────────
    if (domain.handleWhatsAppCommand) {
      const domainReply = await domain.handleWhatsAppCommand(text, lower, from, ctx);
      if (domainReply !== null) {
        await wa.sendText(from, domainReply);
        return;
      }
    }

    // ── Fallback: agente LLM ──────────────────────────────────────────────────
    if (opts.useLlmFallback !== false) {
      try {
        const out = await runLlmToolAgent([{ role: "user", content: text }], {
          systemPrompt: domain.systemPrompt,
          tools: domain.tools,
          executeTool: (name, args) => domain.executeTool(name, args, ctx),
        });
        await wa.sendText(from, out.reply);
      } catch {
        await wa.sendText(from, `Olá! Envie "ajuda" para ver os comandos disponíveis.`);
      }
      return;
    }

    await wa.sendText(from, `Olá! Envie "ajuda" para ver os comandos disponíveis.`);
  });
}

/**
 * @deprecated Use attachDomainWhatsAppBot com pizzeriaDomain.
 * Mantido para compatibilidade com código existente.
 */
export { attachDomainWhatsAppBot as attachDemoWhatsAppBot };
export type { DomainContext as DemoBotStores };
