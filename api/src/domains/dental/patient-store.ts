import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ScheduleStore } from "../../services/schedule-store.js";
import { getPgPool } from "../../services/pg.js";
import { serviceById } from "./catalog.js";

export type PatientAppointment = {
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

export interface PatientStoreOptions {
  persistence?: "memory" | "postgres";
  pool?: Pool;
  onAppointmentCreated?: (appointment: PatientAppointment) => Promise<void> | void;
}

/**
 * Store para pacientes e consultas.
 * Coordena com ScheduleStore para garantir que o slot seja reservado.
 */
export class PatientStore {
  private readonly persistence: "memory" | "postgres";
  private readonly pool: Pool | null;
  private onAppointmentCreated: ((appointment: PatientAppointment) => Promise<void> | void) | null;
  private schemaReady: Promise<void> | null = null;
  private appointments = new Map<string, PatientAppointment>();

  constructor(options?: PatientStoreOptions) {
    this.persistence = options?.persistence ?? "memory";
    this.pool = this.persistence === "postgres" ? (options?.pool ?? getPgPool()) : null;
    this.onAppointmentCreated = options?.onAppointmentCreated ?? null;
  }

  setOnAppointmentCreated(handler: (appointment: PatientAppointment) => Promise<void> | void): void {
    this.onAppointmentCreated = handler;
  }

  async createAppointment(
    schedule: ScheduleStore,
    input: {
      slotId: string;
      patientName: string;
      phone: string;
      serviceId: string;
      notes?: string;
    }
  ): Promise<PatientAppointment | { error: string }> {
    const svc = serviceById(input.serviceId);
    if (!svc) return { error: "invalid_service" };

    const slots = schedule.getSlotsForDay(input.slotId.slice(0, 10));
    const slot = slots.find((s) => s.id === input.slotId);
    if (!slot) return { error: "invalid_slot" };

    const booking = await schedule.createBooking({
      slotId: slot.id,
      startsAt: slot.startsAt,
      customerName: input.patientName,
      phone: input.phone,
    });

    if ("error" in booking) return { error: booking.error };

    const appt: PatientAppointment = {
      id: randomUUID(),
      bookingId: booking.id,
      patientName: booking.customerName,
      phone: booking.phone,
      serviceId: svc.id,
      serviceName: svc.name,
      startsAt: booking.startsAt,
      ...(input.notes ? { notes: input.notes } : {}),
      createdAt: new Date().toISOString(),
    };

    if (this.persistence !== "postgres") {
      this.appointments.set(appt.id, appt);
      await this.emitAppointmentCreated(appt);
      return appt;
    }

    await this.ensureSchema();
    await this.pool!.query(
      `
      INSERT INTO appointments (id, booking_id, patient_name, phone, service_id, service_name, starts_at, notes, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9::timestamptz)
      `,
      [
        appt.id,
        appt.bookingId,
        appt.patientName,
        appt.phone,
        appt.serviceId,
        appt.serviceName,
        appt.startsAt,
        appt.notes ?? null,
        appt.createdAt,
      ]
    );

    await this.emitAppointmentCreated(appt);
    return appt;
  }

  async listAppointmentsByPhone(phone: string): Promise<PatientAppointment[]> {
    const p = phone.replace(/\D/g, "") || phone;
    if (this.persistence !== "postgres") {
      return [...this.appointments.values()]
        .filter((a) => a.phone === p)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }

    await this.ensureSchema();
    const res = await this.pool!.query<{
      id: string;
      booking_id: string;
      patient_name: string;
      phone: string;
      service_id: string;
      service_name: string;
      starts_at: string;
      notes: string | null;
      created_at: string;
    }>(
      `
      SELECT id, booking_id, patient_name, phone, service_id, service_name, starts_at::text, notes, created_at::text
      FROM appointments
      WHERE phone = $1
      ORDER BY starts_at ASC
      `,
      [p]
    );
    return res.rows.map((row: {
      id: string;
      booking_id: string;
      patient_name: string;
      phone: string;
      service_id: string;
      service_name: string;
      starts_at: string;
      notes: string | null;
      created_at: string;
    }) => ({
      id: row.id,
      bookingId: row.booking_id,
      patientName: row.patient_name,
      phone: row.phone,
      serviceId: row.service_id,
      serviceName: row.service_name,
      startsAt: row.starts_at,
      ...(row.notes ? { notes: row.notes } : {}),
      createdAt: row.created_at,
    }));
  }

  async listAll(): Promise<PatientAppointment[]> {
    if (this.persistence !== "postgres") {
      return [...this.appointments.values()].sort((a, b) =>
        a.startsAt.localeCompare(b.startsAt)
      );
    }

    await this.ensureSchema();
    const res = await this.pool!.query<{
      id: string;
      booking_id: string;
      patient_name: string;
      phone: string;
      service_id: string;
      service_name: string;
      starts_at: string;
      notes: string | null;
      created_at: string;
    }>(
      `
      SELECT id, booking_id, patient_name, phone, service_id, service_name, starts_at::text, notes, created_at::text
      FROM appointments
      ORDER BY starts_at ASC
      `
    );
    return res.rows.map((row: {
      id: string;
      booking_id: string;
      patient_name: string;
      phone: string;
      service_id: string;
      service_name: string;
      starts_at: string;
      notes: string | null;
      created_at: string;
    }) => ({
      id: row.id,
      bookingId: row.booking_id,
      patientName: row.patient_name,
      phone: row.phone,
      serviceId: row.service_id,
      serviceName: row.service_name,
      startsAt: row.starts_at,
      ...(row.notes ? { notes: row.notes } : {}),
      createdAt: row.created_at,
    }));
  }

  async cancelByBookingId(bookingId: string, schedule: ScheduleStore): Promise<boolean> {
    const canceled = await schedule.cancelBooking(bookingId);
    if (!canceled) return false;

    if (this.persistence !== "postgres") {
      const appt = [...this.appointments.values()].find(
        (a) => a.bookingId === bookingId
      );
      if (!appt) return true;
      this.appointments.delete(appt.id);
      return true;
    }

    await this.ensureSchema();
    await this.pool!.query("DELETE FROM appointments WHERE booking_id = $1", [bookingId]);
    return true;
  }

  private async ensureSchema(): Promise<void> {
    if (this.persistence !== "postgres") return;
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.pool!.query(
          `
          CREATE TABLE IF NOT EXISTS appointments (
            id TEXT PRIMARY KEY,
            booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
            patient_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            service_id TEXT NOT NULL,
            service_name TEXT NOT NULL,
            starts_at TIMESTAMPTZ NOT NULL,
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
          `
        );
        await this.pool!.query(
          "CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments (phone)"
        );
        await this.pool!.query(
          "CREATE INDEX IF NOT EXISTS idx_appointments_starts_at ON appointments (starts_at)"
        );
      })();
    }
    await this.schemaReady;
  }

  private async emitAppointmentCreated(appointment: PatientAppointment): Promise<void> {
    if (!this.onAppointmentCreated) return;

    try {
      await this.onAppointmentCreated(appointment);
    } catch (err) {
      console.error("[patient-store] onAppointmentCreated failed", {
        bookingId: appointment.bookingId,
        phone: appointment.phone,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
