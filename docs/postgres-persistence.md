# Postgres Persistence (Agenda e Bookings)

Este documento descreve como a persistencia de agenda e bookings funciona no projeto.

## Objetivo

Trocar armazenamento in-memory por PostgreSQL sem quebrar o contrato dos endpoints e das tools.

## Estrategia

- Slots: continuam calculados por regra de negocio (dias/horarios do dominio).
- Bookings: persistidos em `bookings`.
- Appointments: persistidos em `appointments`.
- Disponibilidade: slot e' considerado ocupado quando existe `bookings.slot_id` igual.

## Tabelas

Definidas em `api/sql/001_init_schedule.sql`.

- `bookings`
  - `id` (PK)
  - `slot_id` (UNIQUE)
  - `starts_at`
  - `customer_name`
  - `phone`
  - `created_at`

- `appointments`
  - `id` (PK)
  - `booking_id` (UNIQUE, FK -> bookings.id)
  - `patient_name`
  - `phone`
  - `service_id`
  - `service_name`
  - `starts_at`
  - `notes`
  - `created_at`

## Ativacao

No ambiente da API:

- `SCHEDULE_PERSISTENCE=postgres`
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`

Ou usar `DATABASE_URL`.

## Comandos uteis

Aplicar migration:

```bash
psql postgresql://schedule_ai:schedule_ai@localhost:5432/schedule_ai -f api/sql/001_init_schedule.sql
```

Subir stack inteira:

```bash
docker compose up --build
```

## Observacoes

- Seed SQL nao e' obrigatorio para funcionamento.
- Em ambiente de demo, seed pode ajudar a mostrar listagens desde o inicio.