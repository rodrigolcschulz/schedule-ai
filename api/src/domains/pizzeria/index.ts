import type { BusinessDomain, DomainContext } from "../types.js";
import { LLM_TOOLS, executeLlmTool, type ToolContext } from "../../services/llm-tools.js";
import { ScheduleStore, formatSlotTimeBr } from "../../services/schedule-store.js";
import { OrderStore } from "../../services/order-store.js";
import {
  formatMenuWhatsApp,
  resolveFlavorIdFromText,
  resolveDrinkIdFromText,
  resolvePizzaSize,
} from "../../services/pizzeria-catalog.js";

const PIZZERIA_SYSTEM_PROMPT =
  process.env.LLM_AGENT_SYSTEM_PROMPT ??
  [
    "Você é o assistente da Pizzaria Demo.",
    "Use as ferramentas para consultar cardápio, horários à noite (Brasília), criar pedidos e agendamentos.",
    "Quando o usuário quiser pedir pizza ou marcar horário, chame as ferramentas em vez de inventar preços ou vagas.",
    "Telefone: pode normalizar só com dígitos.",
  ].join(" ");

/** Pizzaria atende à noite: 18h–22h */
const PIZZERIA_SCHEDULE = { firstHour: 18, lastStartHour: 22 };

const PIZZERIA_WA_HELP = [
  "Comandos:",
  "ajuda — esta mensagem",
  "",
  "Agenda:",
  "horarios YYYY-MM-DD — slots livres (noite, horário de Brasília)",
  "agendar YYYY-MM-DD HH nome — HH entre 18 e 22 (ex: agendar 2026-05-10 20 Maria)",
  "meus — seus agendamentos",
  "cancelar ID — cancela agendamento",
  "",
  "Pizzaria (demo):",
  "cardapio — preços e sabores",
  "pedir SABOR TAMANHO — ex: pedir calabresa grande",
  "pedir refri 600 | pedir refri 2l",
  "vários: pedir calabresa medio + refri 2l",
  "meus pedidos — seus pedidos deste número",
].join("\n");

function parseOrderSegments(text: string): string[] {
  const lower = text.toLowerCase();
  const prefix = lower.startsWith("pedir ") ? "pedir " : lower.startsWith("pedido ") ? "pedido " : null;
  if (!prefix) return [];
  return text
    .slice(prefix.length)
    .trim()
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
}

function tryParseOrderLine(
  segment: string
):
  | { kind: "pizza"; flavorId: string; size: "medio" | "grande" }
  | { kind: "drink"; drinkId: string }
  | undefined {
  const drinkId = resolveDrinkIdFromText(segment);
  const flavorId = resolveFlavorIdFromText(segment);
  const size = resolvePizzaSize(segment);
  const mentionsDrink =
    /\brefri|refrigerante|600\b|\b2\s*l\b|\b2l\b|\blata\b|\bgarrafa\b/i.test(segment);

  if (drinkId && (mentionsDrink || !flavorId)) {
    return { kind: "drink", drinkId };
  }
  if (flavorId && size) {
    return { kind: "pizza", flavorId, size };
  }
  return undefined;
}

type PizzeriaCtx = DomainContext & { orders: OrderStore };

export const pizzeriaDomain: BusinessDomain = {
  id: "pizzeria",
  displayName: "Pizzaria Demo",
  systemPrompt: PIZZERIA_SYSTEM_PROMPT,
  tools: LLM_TOOLS,

  executeTool(name, args, ctx) {
    const pCtx = ctx as PizzeriaCtx;
    const toolCtx: ToolContext = { schedule: pCtx.schedule, orders: pCtx.orders };
    return executeLlmTool(name, args, toolCtx);
  },

  createContext(): DomainContext {
    const schedule = new ScheduleStore(PIZZERIA_SCHEDULE);
    const orders = new OrderStore();
    return { schedule, orders };
  },

  whatsAppHelp: PIZZERIA_WA_HELP,

  async handleWhatsAppCommand(text, lower, from, ctx) {
    const { schedule, orders } = ctx as PizzeriaCtx;

    if (lower === "cardapio" || lower === "cardápio" || lower === "menu") {
      return formatMenuWhatsApp();
    }

    if (lower.startsWith("pedir ") || lower.startsWith("pedido ")) {
      const segments = parseOrderSegments(text);
      if (segments.length === 0) {
        return "Exemplo: pedir calabresa grande\nOu: pedir 3 queijos medio + refri 2l";
      }

      const items: Array<
        | { kind: "pizza"; flavorId: string; size: "medio" | "grande" }
        | { kind: "drink"; drinkId: string }
      > = [];

      for (const seg of segments) {
        const line = tryParseOrderLine(seg);
        if (!line) {
          return `Não entendi o item: "${seg}". Envie cardapio e use SABOR + medio ou grande.`;
        }
        items.push(line);
      }

      const res = orders.createOrder({
        customerName: `Cliente ${from}`,
        phone: from,
        items,
      });

      if ("error" in res) {
        return "Não foi possível montar o pedido. Verifique sabores e tamanhos.";
      }

      const desc = res.lines
        .map((l) =>
          l.kind === "pizza"
            ? `${l.flavorName} (${l.sizeLabel})`
            : `${l.name} ${l.volumeLabel}`
        )
        .join(", ");
      return `Pedido ${res.id.slice(0, 8)}… — R$ ${res.totalReais}\n${desc}\n(Obrigado! Demo sem pagamento.)`;
    }

    if (lower === "meus pedidos" || lower === "meuspedidos") {
      const mine = orders.listOrdersByPhone(from);
      if (mine.length === 0) return "Nenhum pedido deste número ainda.";
      return mine
        .slice(0, 5)
        .map((o) => `• ${o.id.slice(0, 8)}… R$ ${o.totalReais}`)
        .join("\n");
    }

    return null; // passa para o agente LLM ou handler genérico
  },
};
