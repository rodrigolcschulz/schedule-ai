import type { BusinessDomain, DomainContext } from "../types.js";
import { DENTAL_TOOLS, executeDentalTool } from "./tools.js";
import { DENTAL_SYSTEM_PROMPT } from "./prompt.js";
import { ScheduleStore, formatSlotTimeBr } from "../../services/schedule-store.js";
import { PatientStore } from "./patient-store.js";
import { formatServicesText, resolveServiceIdFromText, serviceById } from "./catalog.js";

function formatPriceReply(serviceId: string): string {
  const svc = serviceById(serviceId);
  if (!svc) return "Não encontrei esse serviço no catálogo.";

  if (svc.priceReais > 0) {
    return `R$ ${svc.priceReais}`;
  }

  return "incluso no tratamento";
}

function formatDurationReply(serviceId: string): string {
  const svc = serviceById(serviceId);
  if (!svc) return "Não encontrei esse serviço no catálogo.";
  return `${svc.durationMinutes} minutos`;
}

function formatAppointmentTimeReply(appointment: { startsAt: string; serviceName: string }): string {
  return `${appointment.serviceName} está agendado para ${formatSlotTimeBr(appointment.startsAt)}.`;
}

/** Clínica funciona seg–sex 8h–17h (último slot inicia às 17h, termina 18h) */
const DENTAL_SCHEDULE = {
  firstHour: 8,
  lastStartHour: 17,
  allowedWeekdays: [1, 2, 3, 4, 5],
};

const DENTAL_WA_HELP = [
  "Clínica Odonto Demo — Comandos:",
  "",
  "servicos — lista de procedimentos e preços",
  "valor / preço — informa o preço de um serviço ou do seu agendamento",
  "duração / tempo — informa a duração de um serviço",
  "horário / hora — informa o horário do seu atendimento agendado",
  "horarios YYYY-MM-DD — horários disponíveis",
  "agendar YYYY-MM-DD HH Nome SERVIÇO — ex: agendar 2026-05-10 09 Maria limpeza",
  "meus — suas consultas agendadas",
  "cancelar BOOKING_ID — cancela consulta",
  "",
  "Ou simplesmente descreva o que precisa e a IA responde!",
].join("\n");

export const dentalDomain: BusinessDomain = {
  id: "dental",
  displayName: "Clínica Odonto Demo",
  systemPrompt: DENTAL_SYSTEM_PROMPT,
  tools: DENTAL_TOOLS,

  executeTool(name, args, ctx) {
    return executeDentalTool(name, args, ctx as DomainContext & { patients: PatientStore });
  },

  createContext(): DomainContext {
    const persistence =
      (process.env.SCHEDULE_PERSISTENCE ?? "memory").toLowerCase() === "postgres"
        ? "postgres"
        : "memory";

    const schedule = new ScheduleStore(DENTAL_SCHEDULE, { persistence });
    const patients = new PatientStore({ persistence });
    return { schedule, patients };
  },

  whatsAppHelp: DENTAL_WA_HELP,

  async handleWhatsAppCommand(text, lower, from, ctx) {
    const { schedule, patients } = ctx as { schedule: ScheduleStore; patients: PatientStore };

    if (lower === "servicos" || lower === "serviços" || lower === "procedimentos") {
      return `Serviços da Clínica Odonto Demo:\n\n${formatServicesText()}`;
    }

    const asksForPrice = /\b(valor|preço|preco|quanto custa|custa|qual o valor|qual o preço)\b/i.test(lower);
    if (asksForPrice) {
      const serviceIdFromText = resolveServiceIdFromText(text);
      if (serviceIdFromText) {
        const svc = serviceById(serviceIdFromText);
        if (!svc) {
          return "Não encontrei esse serviço no catálogo.";
        }
        return `O valor de ${svc.name} é ${formatPriceReply(serviceIdFromText)}.`;
      }

      const appointments = await patients.listAppointmentsByPhone(from);
      const latestAppointment = appointments.at(-1);
      if (latestAppointment) {
        return `O valor do seu último serviço agendado (${latestAppointment.serviceName}) é ${formatPriceReply(latestAppointment.serviceId)}.`;
      }

      return "Posso te informar o valor de um procedimento. Tente algo como 'qual o valor da limpeza?' ou 'qual o valor desse serviço agendado?'.";
    }

    const asksForDuration = /\b(duração|duracao|tempo|quanto tempo|qual a duração)\b/i.test(lower);
    if (asksForDuration) {
      const serviceIdFromText = resolveServiceIdFromText(text);
      if (serviceIdFromText) {
        const svc = serviceById(serviceIdFromText);
        if (!svc) {
          return "Não encontrei esse serviço no catálogo.";
        }
        return `${svc.name} tem duração de ${formatDurationReply(serviceIdFromText)}.`;
      }

      return "Posso te informar a duração de um procedimento. Tente algo como 'qual a duração da limpeza?'.";
    }

    const asksForAppointmentTime = /\b(horário|horario|hora|qual o horário|qual a hora|quando é|quando começa)\b/i.test(lower);
    if (asksForAppointmentTime) {
      const appointments = await patients.listAppointmentsByPhone(from);
      const latestAppointment = appointments.at(-1);
      if (latestAppointment) {
        return formatAppointmentTimeReply(latestAppointment);
      }

      return "Ainda não encontrei um atendimento agendado para esse telefone.";
    }

    // "agendar YYYY-MM-DD HH Nome SERVICO"
    if (lower.startsWith("agendar ")) {
      const rest = text.slice("agendar ".length).trim();
      const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2})\s+(.+)$/.exec(rest);
      if (!m) {
        return "Formato: agendar YYYY-MM-DD HH Nome Serviço\nEx: agendar 2026-05-10 09 Maria limpeza";
      }
      const date = m[1];
      const hour = m[2].padStart(2, "0");
      const remainder = m[3].trim();

      const serviceId = resolveServiceIdFromText(remainder);
      const patientName = serviceId
        ? remainder.replace(new RegExp(serviceById(serviceId)!.keywords.join("|"), "i"), "").trim() || remainder
        : remainder;

      if (!serviceId) {
        return `Serviço não reconhecido em: "${remainder}".\nEnvie "servicos" para ver a lista.`;
      }

      const slotId = `${date}_${hour}00`;
      const slots = schedule.getSlotsForDay(date);
      const slot = slots.find((s) => s.id === slotId);

      if (!slot) {
        return `Horário ${hour}h inválido para ${date}. Envie "horarios ${date}" para ver disponíveis.`;
      }

      const res = await patients.createAppointment(schedule, {
        slotId: slot.id,
        patientName: patientName || `Paciente ${from}`,
        phone: from,
        serviceId,
      });

      if ("error" in res) {
        if (res.error === "slot_occupied") {
          return `Esse horário já está ocupado. Envie "horarios ${date}" para ver horários livres.`;
        }
        return `Erro ao agendar: ${res.error}`;
      }

      const timeLabel = formatSlotTimeBr(res.startsAt);
      return (
        `Consulta agendada!\n` +
        `Paciente: ${res.patientName}\n` +
        `Serviço: ${res.serviceName}\n` +
        `Horário: ${timeLabel} (${date})\n` +
        `ID de cancelamento: ${res.bookingId}`
      );
    }

    return null; // passa para o agente LLM
  },
};
