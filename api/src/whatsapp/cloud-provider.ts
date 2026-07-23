import type {
  IncomingWhatsAppMessage,
  IncomingWhatsAppStatusUpdate,
  WhatsAppProvider,
} from "./types.js";

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v20.0";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value.trim();
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "") || raw;
}

function readTextBody(message: Record<string, unknown>): string {
  const text = message.text;
  if (typeof text === "object" && text !== null) {
    const body = (text as Record<string, unknown>).body;
    if (typeof body === "string") return body;
  }
  return "";
}

export function createCloudWhatsAppProvider(): WhatsAppProvider {
  const handlers: Array<(msg: IncomingWhatsAppMessage) => void> = [];
  const statusHandlers: Array<(status: IncomingWhatsAppStatusUpdate) => void> = [];
  const accessToken = requiredEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = requiredEnv("WHATSAPP_PHONE_NUMBER_ID");
  const verifyToken = requiredEnv("WHATSAPP_VERIFY_TOKEN");

  const endpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  return {
    name: "cloud",
    async start() {
      console.info("[whatsapp:cloud] started");
    },
    async stop() {
      console.info("[whatsapp:cloud] stopped");
    },
    async sendText(to: string, body: string) {
      const normalizedTo = normalizePhone(to);
      console.info("[whatsapp:cloud] sending text", {
        to: normalizedTo,
        bodyLength: body.length,
      });

      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizedTo,
        type: "text",
        text: { body },
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error("[whatsapp:cloud] sendText failed", {
          status: response.status,
          detail,
          to: normalizedTo,
        });
        throw new Error(`Meta Graph sendText failed (${response.status}): ${detail}`);
      }
    },
    onMessage(handler) {
      handlers.push(handler);
    },
    onStatusUpdate(handler) {
      statusHandlers.push(handler);
    },
    verifyWebhook(query) {
      const mode = query["hub.mode"];
      const token = query["hub.verify_token"];
      const challenge = query["hub.challenge"];

      if (mode !== "subscribe") return null;
      if (typeof token !== "string" || token !== verifyToken) return null;
      if (typeof challenge !== "string") return null;
      return challenge;
    },
    handleWebhookPayload(payload) {
      if (!payload || typeof payload !== "object") return;

      const root = payload as Record<string, unknown>;
      const entries = Array.isArray(root.entry) ? root.entry : [];
      console.info("[whatsapp:cloud] webhook payload received", {
        entryCount: entries.length,
      });

      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const changes = Array.isArray((entry as Record<string, unknown>).changes)
          ? ((entry as Record<string, unknown>).changes as unknown[])
          : [];

        for (const change of changes) {
          if (!change || typeof change !== "object") continue;
          const value = (change as Record<string, unknown>).value;
          if (!value || typeof value !== "object") continue;

          const valueObj = value as Record<string, unknown>;
          const messages = Array.isArray(valueObj.messages) ? valueObj.messages : [];
          const statuses = Array.isArray(valueObj.statuses) ? valueObj.statuses : [];

          for (const message of messages) {
            if (!message || typeof message !== "object") continue;
            const messageObj = message as Record<string, unknown>;
            if (messageObj.type !== "text") continue;

            const from = typeof messageObj.from === "string" ? messageObj.from : undefined;
            const body = readTextBody(messageObj);
            if (!from || !body) continue;

            const incoming: IncomingWhatsAppMessage = {
              from: normalizePhone(from),
              text: body,
              messageId: typeof messageObj.id === "string" ? messageObj.id : undefined,
              raw: messageObj,
            };

            console.info("[whatsapp:cloud] inbound message", {
              from: incoming.from,
              messageId: incoming.messageId,
              text: body,
            });

            for (const handler of handlers) {
              Promise.resolve(handler(incoming)).catch((err) => {
                console.error("[whatsapp:cloud] inbound handler failed", {
                  from: incoming.from,
                  messageId: incoming.messageId,
                  error: err instanceof Error ? err.message : String(err),
                });
              });
            }
          }

          for (const status of statuses) {
            if (!status || typeof status !== "object") continue;
            const statusObj = status as Record<string, unknown>;
            const statusValue = typeof statusObj.status === "string" ? statusObj.status : undefined;
            if (!statusValue) continue;

            const conversation =
              typeof statusObj.conversation === "object" && statusObj.conversation !== null
                ? (statusObj.conversation as Record<string, unknown>)
                : undefined;
            const pricing =
              typeof statusObj.pricing === "object" && statusObj.pricing !== null
                ? (statusObj.pricing as Record<string, unknown>)
                : undefined;

            const update: IncomingWhatsAppStatusUpdate = {
              status: statusValue,
              messageId: typeof statusObj.id === "string" ? statusObj.id : undefined,
              recipientId: typeof statusObj.recipient_id === "string" ? statusObj.recipient_id : undefined,
              timestamp: typeof statusObj.timestamp === "string" ? statusObj.timestamp : undefined,
              conversationId: typeof conversation?.id === "string" ? conversation.id : undefined,
              pricingCategory: typeof pricing?.category === "string" ? pricing.category : undefined,
              raw: statusObj,
            };

            for (const handler of statusHandlers) {
              Promise.resolve(handler(update)).catch((err) => {
                console.error("[whatsapp:cloud] status handler failed", {
                  status: update.status,
                  messageId: update.messageId,
                  error: err instanceof Error ? err.message : String(err),
                });
              });
            }
          }
        }
      }
    },
  };
}
