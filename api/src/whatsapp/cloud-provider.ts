import type { IncomingWhatsAppMessage, WhatsAppProvider } from "./types.js";

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
      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizePhone(to),
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
        throw new Error(`Meta Graph sendText failed (${response.status}): ${detail}`);
      }
    },
    onMessage(handler) {
      handlers.push(handler);
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

            for (const handler of handlers) {
              handler(incoming);
            }
          }
        }
      }
    },
  };
}
