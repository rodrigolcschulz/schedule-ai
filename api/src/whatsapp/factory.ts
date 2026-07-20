import type { WhatsAppProvider } from "./types.js";
import { createStubWhatsAppProvider } from "./stub-provider.js";
import { createCloudWhatsAppProvider } from "./cloud-provider.js";

export type WhatsAppProviderKind = "stub" | "cloud" | "baileys";

export function createWhatsAppProvider(kind: WhatsAppProviderKind): WhatsAppProvider {
  if (kind === "stub") return createStubWhatsAppProvider();
  if (kind === "cloud") return createCloudWhatsAppProvider();
  throw new Error(
    "WHATSAPP_PROVIDER=baileys ainda não implementado. Adicione @whiskeysockets/baileys e implemente BaileysWhatsAppProvider."
  );
}
