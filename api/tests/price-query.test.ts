import test from "node:test";
import assert from "node:assert/strict";
import { dentalDomain } from "../src/domains/dental/index.js";
import type { PatientAppointment } from "../src/domains/dental/patient-store.js";

test("responde o preço quando o paciente menciona um serviço", async () => {
  const ctx = {
    schedule: { getSlotsForDay: () => [] },
    patients: {
      listAppointmentsByPhone: async () => [],
    },
  } as any;

  const reply = await dentalDomain.handleWhatsAppCommand?.(
    "qual o valor da limpeza?",
    "qual o valor da limpeza?",
    "+5511999999999",
    ctx
  );

  assert.match(reply ?? "", /R\$ 150/);
});

test("responde o preço do último agendamento do telefone", async () => {
  const appointment: PatientAppointment = {
    id: "appt-1",
    bookingId: "booking-1",
    patientName: "Anne",
    phone: "+5511999999999",
    serviceId: "restauracao",
    serviceName: "Restauração / Obturação",
    startsAt: "2026-05-10T09:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
  };

  const ctx = {
    schedule: { getSlotsForDay: () => [] },
    patients: {
      listAppointmentsByPhone: async () => [appointment],
    },
  } as any;

  const reply = await dentalDomain.handleWhatsAppCommand?.(
    "qual o valor desse serviço agendado?",
    "qual o valor desse serviço agendado?",
    "+5511999999999",
    ctx
  );

  assert.match(reply ?? "", /R\$ 250/);
});

test("responde a duração quando o paciente pergunta", async () => {
  const ctx = {
    schedule: { getSlotsForDay: () => [] },
    patients: {
      listAppointmentsByPhone: async () => [],
    },
  } as any;

  const reply = await dentalDomain.handleWhatsAppCommand?.(
    "qual a duração da limpeza?",
    "qual a duração da limpeza?",
    "+5511999999999",
    ctx
  );

  assert.match(reply ?? "", /60 minutos/);
});

test("responde o horário do último agendamento", async () => {
  const appointment: PatientAppointment = {
    id: "appt-2",
    bookingId: "booking-2",
    patientName: "Anne",
    phone: "+5511999999999",
    serviceId: "avaliacao",
    serviceName: "Avaliação / Consulta",
    startsAt: "2026-05-10T09:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
  };

  const ctx = {
    schedule: { getSlotsForDay: () => [] },
    patients: {
      listAppointmentsByPhone: async () => [appointment],
    },
  } as any;

  const reply = await dentalDomain.handleWhatsAppCommand?.(
    "qual o horário do meu atendimento?",
    "qual o horário do meu atendimento?",
    "+5511999999999",
    ctx
  );

  assert.match(reply ?? "", /\d{2}:\d{2}/);
});
