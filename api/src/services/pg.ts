// @ts-ignore pg typings can be unresolved by editor language server in workspace mode.
import { Pool } from "pg";

let pool: Pool | null = null;

function connectionConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
    };
  }

  return {
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? "schedule_ai",
    user: process.env.PGUSER ?? "schedule_ai",
    password: process.env.PGPASSWORD ?? "schedule_ai",
  };
}

export function getPgPool(): Pool {
  if (!pool) {
    pool = new Pool(connectionConfig());
  }
  return pool;
}