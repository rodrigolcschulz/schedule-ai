import type { PatientAppointment } from "../domains/dental/patient-store.js";
import type { WhatsAppProvider } from "../whatsapp/types.js";

export interface NotificationAgent {
  notifyAppointmentCreated(appointment: PatientAppointment): Promise<void>;
}

function shouldNotify(): boolean {
  const raw = (process.env.WHATSAPP_NOTIFY_ON_BOOKING ?? "true").trim().toLowerCase();
  return raw !== "false";
}

function buildAppointmentMessage(appointment: PatientAppointment): string {
  return [
    `Oi, ${appointment.patientName}!`,
    "Seu agendamento foi confirmado.",
    `Servico: ${appointment.serviceName}`,
    `Data/Hora: ${new Date(appointment.startsAt).toLocaleString("pt-BR")}`,
    `Codigo: ${appointment.bookingId}`,
  ].join("\n");
}

export function createNotificationAgent(wa: WhatsAppProvider): NotificationAgent {
  return {
    async notifyAppointmentCreated(appointment) {
      if (!shouldNotify()) return;

      try {
        await wa.sendText(appointment.phone, buildAppointmentMessage(appointment));
      } catch (err) {
        console.error("[notification-agent] failed to send WhatsApp message", {
          bookingId: appointment.bookingId,
          phone: appointment.phone,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
