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

const base = "";

export async function fetchSlots(date: string): Promise<SlotRow[]> {
  const r = await fetch(`${base}/slots?date=${encodeURIComponent(date)}`);
  if (!r.ok) throw new Error("Falha ao carregar horários");
  const j = (await r.json()) as { slots: SlotRow[] };
  return j.slots;
}

export async function fetchServices(): Promise<DentalService[]> {
  const r = await fetch(`${base}/catalog`);
  if (!r.ok) throw new Error("Falha ao carregar serviços");
  const j = (await r.json()) as { services?: DentalService[] };
  return j.services ?? [];
}

export async function createBooking(input: {
  slotId: string;
  customerName: string;
  phone: string;
  serviceId?: string;
  notes?: string;
}): Promise<Booking> {
  const r = await fetch(`${base}/bookings`, {
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
  const r = await fetch(`${base}/bookings`);
  if (!r.ok) throw new Error("Falha ao listar");
  return r.json() as Promise<Booking[]>;
}

export async function listAppointments(phone?: string): Promise<Appointment[]> {
  const url = phone
    ? `${base}/appointments?phone=${encodeURIComponent(phone)}`
    : `${base}/appointments`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Falha ao listar consultas");
  const j = (await r.json()) as { appointments: Appointment[] };
  return j.appointments;
}

export async function cancelBooking(id: string): Promise<void> {
  const r = await fetch(`${base}/bookings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error("Falha ao cancelar");
}

export async function fetchLlmStatus(): Promise<LlmStatus> {
  const r = await fetch(`${base}/llm/status`);
  if (!r.ok) throw new Error("Falha ao ler status do LLM");
  return r.json() as Promise<LlmStatus>;
}

export async function fetchLlmChat(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<{ reply: string }> {
  const r = await fetch(`${base}/llm/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
    throw new Error(err.detail ?? err.error ?? "Falha no chat");
  }
  return r.json() as Promise<{ reply: string }>;
}

export async function fetchLlmChatAgent(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<{ reply: string; trace?: LlmAgentTrace }> {
  const r = await fetch(`${base}/llm/chat/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
    throw new Error(err.detail ?? err.error ?? "Falha no agente");
  }
  return r.json() as Promise<{ reply: string; trace?: LlmAgentTrace }>;
}
