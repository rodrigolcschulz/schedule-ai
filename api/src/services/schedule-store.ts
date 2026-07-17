// services/schedule-store.ts
// Gera os horários (slots) e persiste bookings em memória ou PostgreSQL.

import { randomUUID } from "node:crypto";
// @ts-ignore pg typings can be unresolved by editor language server in workspace mode.
import type { Pool } from "pg";
import { getPgPool } from "./pg.js";

export interface ScheduleConfig {
  /** Hora de início do primeiro slot do dia (0-23) */
  firstHour: number;
  /** Hora de início do último slot do dia (0-23); cada slot dura 1h */
  lastStartHour: number;
  /** Dias da semana permitidos: 0=domingo ... 6=sábado */
  allowedWeekdays: number[];
  /** Timezone usado pra gerar os horários (default: America/Sao_Paulo) */
  timezone?: string;
}

export interface Slot {
  /** Formato: `${date}_${HH}00`, ex: "2026-05-10_0900" */
  id: string;
  /** ISO 8601 com offset, ex: "2026-05-10T09:00:00-03:00" */
  startsAt: string;
  endsAt: string;
}

export interface Booking {
  id: string;
  slotId: string;
  startsAt: string;
  customerName: string;
  phone: string;
}

export interface CreateBookingInput {
  slotId: string;
  startsAt: string;
  customerName: string;
  phone: string;
}

export type CreateBookingResult = Booking | { error: "slot_occupied" };

export interface ScheduleStoreOptions {
  persistence?: "memory" | "postgres";
  pool?: Pool;
}

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
/** Offset fixo de America/Sao_Paulo (UTC-3, sem horário de verão desde 2019) */
const SAO_PAULO_UTC_OFFSET = "-03:00";

export class ScheduleStore {
  private readonly config: Required<ScheduleConfig>;
  private readonly persistence: "memory" | "postgres";
  private readonly pool: Pool | null;
  private schemaReady: Promise<void> | null = null;
  private readonly bookingsById = new Map<string, Booking>();
  private readonly bookingIdBySlot = new Map<string, string>();

  constructor(config: ScheduleConfig, options?: ScheduleStoreOptions) {
    this.config = {
      timezone: DEFAULT_TIMEZONE,
      ...config,
    };
    this.persistence = options?.persistence ?? "memory";
    this.pool = this.persistence === "postgres" ? (options?.pool ?? getPgPool()) : null;
  }

  /**
   * Gera os slots possíveis para um dia (não diz se estão ocupados —
   * para isso, cruze com getBookedSlotIds()). Retorna lista vazia se a
   * data cair fora dos dias permitidos ou tiver formato inválido.
   */
  getSlotsForDay(date: string): Slot[] {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];

    const weekday = this.weekdayFor(date);
    if (!this.config.allowedWeekdays.includes(weekday)) return [];

    const slots: Slot[] = [];
    for (let hour = this.config.firstHour; hour <= this.config.lastStartHour; hour++) {
      const hh = String(hour).padStart(2, "0");
      slots.push({
        id: `${date}_${hh}00`,
        startsAt: this.toIso(date, hour),
        endsAt: this.toIso(date, hour + 1),
      });
    }
    return slots;
  }

  /** IDs de todos os slots que já têm booking ativo (em qualquer data) */
  async getBookedSlotIds(): Promise<Set<string>> {
    if (this.persistence !== "postgres") {
      return new Set(this.bookingIdBySlot.keys());
    }

    await this.ensureSchema();
    const res = await this.pool!.query<{ slot_id: string }>(
      "SELECT slot_id FROM bookings"
    );
    return new Set(res.rows.map((row: { slot_id: string }) => row.slot_id));
  }

  async createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
    if (this.persistence !== "postgres") {
      if (this.bookingIdBySlot.has(input.slotId)) {
        return { error: "slot_occupied" };
      }

      const booking: Booking = {
        id: this.generateBookingId(),
        slotId: input.slotId,
        startsAt: input.startsAt,
        customerName: input.customerName,
        phone: input.phone,
      };

      this.bookingsById.set(booking.id, booking);
      this.bookingIdBySlot.set(input.slotId, booking.id);
      return booking;
    }

    await this.ensureSchema();

    const booking: Booking = {
      id: this.generateBookingId(),
      slotId: input.slotId,
      startsAt: input.startsAt,
      customerName: input.customerName,
      phone: input.phone,
    };

    try {
      await this.pool!.query(
        `
        INSERT INTO bookings (id, slot_id, starts_at, customer_name, phone)
        VALUES ($1, $2, $3::timestamptz, $4, $5)
        `,
        [booking.id, booking.slotId, booking.startsAt, booking.customerName, booking.phone]
      );
      return booking;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "23505") return { error: "slot_occupied" };
      throw err;
    }
  }

  async getBooking(id: string): Promise<Booking | undefined> {
    if (this.persistence !== "postgres") {
      return this.bookingsById.get(id);
    }

    await this.ensureSchema();
    const res = await this.pool!.query<{
      id: string;
      slot_id: string;
      starts_at: string;
      customer_name: string;
      phone: string;
    }>(
      `
      SELECT id, slot_id, starts_at::text, customer_name, phone
      FROM bookings
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      slotId: row.slot_id,
      startsAt: row.starts_at,
      customerName: row.customer_name,
      phone: row.phone,
    };
  }

  async listBookings(): Promise<Booking[]> {
    if (this.persistence !== "postgres") {
      return Array.from(this.bookingsById.values());
    }

    await this.ensureSchema();
    const res = await this.pool!.query<{
      id: string;
      slot_id: string;
      starts_at: string;
      customer_name: string;
      phone: string;
    }>(
      `
      SELECT id, slot_id, starts_at::text, customer_name, phone
      FROM bookings
      ORDER BY starts_at ASC
      `
    );
    return res.rows.map((row: {
      id: string;
      slot_id: string;
      starts_at: string;
      customer_name: string;
      phone: string;
    }) => ({
      id: row.id,
      slotId: row.slot_id,
      startsAt: row.starts_at,
      customerName: row.customer_name,
      phone: row.phone,
    }));
  }

  /** Retorna true se cancelou; false se o id não existia */
  async cancelBooking(id: string): Promise<boolean> {
    if (this.persistence !== "postgres") {
      const booking = this.bookingsById.get(id);
      if (!booking) return false;
      this.bookingsById.delete(id);
      this.bookingIdBySlot.delete(booking.slotId);
      return true;
    }

    await this.ensureSchema();
    const res = await this.pool!.query("DELETE FROM bookings WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  private async ensureSchema(): Promise<void> {
    if (this.persistence !== "postgres") return;
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.pool!.query(
          `
          CREATE TABLE IF NOT EXISTS bookings (
            id TEXT PRIMARY KEY,
            slot_id TEXT NOT NULL UNIQUE,
            starts_at TIMESTAMPTZ NOT NULL,
            customer_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
          `
        );
        await this.pool!.query(
          "CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings (phone)"
        );
        await this.pool!.query(
          "CREATE INDEX IF NOT EXISTS idx_bookings_starts_at ON bookings (starts_at)"
        );
      })();
    }
    await this.schemaReady;
  }

  private weekdayFor(date: string): number {
    // Calcula o dia da semana de forma estável (UTC), sem depender do
    // timezone do processo que está rodando o Node.
    const [y, m, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  private toIso(date: string, hour: number): string {
    const hh = String(hour).padStart(2, "0");
    return `${date}T${hh}:00:00${SAO_PAULO_UTC_OFFSET}`;
  }

  private generateBookingId(): string {
    return `bk_${randomUUID().replaceAll("-", "")}`;
  }
}

/** Formata um ISO string (com offset) para exibição em pt-BR, ex: "10/05 09:00" */
export function formatSlotTimeBr(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: DEFAULT_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}