CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL UNIQUE,
  starts_at TIMESTAMPTZ NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings (phone);
CREATE INDEX IF NOT EXISTS idx_bookings_starts_at ON bookings (starts_at);

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
);

CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments (phone);
CREATE INDEX IF NOT EXISTS idx_appointments_starts_at ON appointments (starts_at);