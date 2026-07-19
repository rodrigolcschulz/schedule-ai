export type SlotRow = {
  id: string;
  startsAt: string;
  endsAt: string;
  available: boolean;
};

export type Booking = {
  id: string;
  slotId: string;
  startsAt: string;
  customerName: string;
  phone: string;
  meta?: { serviceId?: string; serviceName?: string };
  createdAt: string;
};

export type DentalService = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceReais: number;
};

export type Appointment = {
  id: string;
  bookingId: string;
  patientName: string;
  phone: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  notes?: string;
  createdAt: string;
};

export type LlmStatus = {
  model: string;
  ollamaUrl: string;
  ollamaReachable: boolean;
  models: string[];
};

export type LlmAgentTrace = Array<{ tool: string; ok: boolean }>;

type LlmChatOptions = {
  sessionId?: string;
};

const configuredBase =
  typeof import.meta !== "undefined" &&
  typeof import.meta.env?.VITE_API_BASE_URL === "string"
    ? import.meta.env.VITE_API_BASE_URL.trim()
    : "";

function normalizeBase(value: string): string {
  if (!value) return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function runtimeApiBases(): string[] {
  if (typeof window === "undefined") {
    return ["http://127.0.0.1:3001", "http://localhost:3001"];
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const hostname = window.location.hostname;
  const hostBase = hostname ? `${protocol}//${hostname}:3001` : "";

  return [hostBase, `${protocol}//127.0.0.1:3001`, `${protocol}//localhost:3001`];
}

const baseCandidates = Array.from(
  new Set([
    ...runtimeApiBases().map(normalizeBase),
    normalizeBase(configuredBase),
    "",
    "/api",
  ])
).filter((base) => base.length > 0 || base === "");

const writeBase = baseCandidates[0] ?? "";

if (!baseCandidates.length) {
  throw new Error("Nenhuma base de API disponível");
}

// Mantém fallback de rota relativa por último para cenários com proxy no servidor web.
if (!baseCandidates.includes("")) {
  baseCandidates.push("");
}
if (!baseCandidates.includes("/api")) {
  baseCandidates.push("/api");
}
;

async function parseJsonResponse<T>(r: Response): Promise<T> {
  const contentType = r.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    const bodySnippet = (await r.text()).slice(0, 120).trim();
    throw new Error(
      `Resposta inesperada do servidor (${r.status}). Conteúdo: ${bodySnippet || "vazio"}`
    );
  }

  return (await r.json()) as T;
}

async function getJsonWithFallback<T>(
  path: string,
  failMessage: string
): Promise<T> {
  const errors: string[] = [];

  for (const base of baseCandidates) {
    const url = `${base}${path}`;
    try {
      const r = await fetch(url);
      if (!r.ok) {
        errors.push(`${url} -> HTTP ${r.status}`);
        continue;
      }
      return await parseJsonResponse<T>(r);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "erro desconhecido";
      errors.push(`${url} -> ${detail}`);
    }
  }

  throw new Error(`${failMessage}. ${errors.join(" | ")}`);
}

export async function fetchSlots(date: string): Promise<SlotRow[]> {
  const j = await getJsonWithFallback<{ slots: SlotRow[] }>(
    `/slots?date=${encodeURIComponent(date)}`,
    "Falha ao carregar horários"
  );
  return j.slots;
}

export async function fetchServices(): Promise<DentalService[]> {
  const j = await getJsonWithFallback<{ services?: DentalService[] }>(
    "/catalog",
    "Falha ao carregar serviços"
  );
  return j.services ?? [];
}

export async function createBooking(input: {
  slotId: string;
  customerName: string;
  phone: string;
  serviceId?: string;
  notes?: string;
}): Promise<Booking> {
  const r = await fetch(`${writeBase}/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Falha ao agendar");
  }
  return r.json() as Promise<Booking>;
}

export async function listBookings(): Promise<Booking[]> {
  return getJsonWithFallback<Booking[]>("/bookings", "Falha ao listar");
}

export async function listAppointments(phone?: string): Promise<Appointment[]> {
  const path = phone
    ? `/appointments?phone=${encodeURIComponent(phone)}`
    : "/appointments";
  const j = await getJsonWithFallback<{ appointments: Appointment[] }>(
    path,
    "Falha ao listar consultas"
  );
  return j.appointments;
}

export async function cancelBooking(id: string): Promise<void> {
  const r = await fetch(`${writeBase}/bookings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error("Falha ao cancelar");
}

export async function fetchApiHealth(): Promise<boolean> {
  const j = await getJsonWithFallback<{ ok?: boolean }>(
    "/health",
    "Falha ao verificar API"
  );
  return j.ok === true;
}

export async function fetchLlmStatus(): Promise<LlmStatus> {
  const r = await fetch(`${writeBase}/llm/status`);
  if (!r.ok) throw new Error("Falha ao ler status do LLM");
  return r.json() as Promise<LlmStatus>;
}

export async function fetchLlmChat(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  options?: LlmChatOptions
): Promise<{ reply: string }> {
  const body: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    sessionId?: string;
  } = { messages };
  if (options?.sessionId) body.sessionId = options.sessionId;

  const r = await fetch(`${writeBase}/llm/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
    throw new Error(err.detail ?? err.error ?? "Falha no chat");
  }
  return r.json() as Promise<{ reply: string }>;
}

export async function fetchLlmChatAgent(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  options?: LlmChatOptions
): Promise<{ reply: string; trace?: LlmAgentTrace }> {
  const body: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    sessionId?: string;
  } = { messages };
  if (options?.sessionId) body.sessionId = options.sessionId;

  const r = await fetch(`${writeBase}/llm/chat/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
    throw new Error(err.detail ?? err.error ?? "Falha no agente");
  }
  return r.json() as Promise<{ reply: string; trace?: LlmAgentTrace }>;
}
