/**
 * Datenbank-Client. Ein einzelner PostgreSQL-Pool je Prozess; die Anwendung
 * greift ausschließlich über `packages/db` zu, nie mit rohem SQL im Handler ([docs/10]).
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export type Db = NodePgDatabase<typeof schema>;

export interface DbConfig {
  /** Verbindungs-URL, z. B. postgres://user:pass@host:5432/db */
  readonly url: string;
  /** Obergrenze des Verbindungspools. Default 10. */
  readonly maxConnections?: number;
}

/** Erzeugt einen getippten Drizzle-Client samt zugrunde liegendem Pool. */
export function createDb(config: DbConfig): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: config.url,
    max: config.maxConnections ?? 10,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
