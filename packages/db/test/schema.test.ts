import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/schema.ts";

/**
 * Sichert, dass die Drizzle-Modelle und die kanonische Migration nicht
 * auseinanderlaufen: Jede Tabelle und jede Spalte des einen muss im anderen
 * vorkommen. Rein textuell und ohne Datenbank — läuft im schnellen CI-Job.
 */

const sql = readFileSync(
  fileURLToPath(new URL("../migrations/0001_init.sql", import.meta.url)),
  "utf8",
).toLowerCase();

const tables = Object.values(schema).filter(
  (v): v is Parameters<typeof getTableConfig>[0] =>
    typeof v === "object" && v !== null && Symbol.for("drizzle:IsDrizzleTable") in v,
);

describe("Drizzle-Modelle stimmen mit der Migration überein", () => {
  it("findet mindestens die Kern-Faktentabellen", () => {
    const names = tables.map((t) => getTableConfig(t).name);
    expect(names).toContain("fact_totals");
    expect(names).toContain("fact_query_page");
    expect(names).toContain("bq_exports");
    expect(tables.length).toBeGreaterThanOrEqual(15);
  });

  for (const table of tables) {
    const cfg = getTableConfig(table);
    const qualified = `${cfg.schema}.${cfg.name}`;

    it(`${qualified}: Tabelle und alle Spalten stehen in der Migration`, () => {
      expect(sql).toContain(`create table ${qualified}`);
      for (const col of cfg.columns) {
        // Spaltenname als Wortgrenze — vermeidet Teiltreffer (z. B. "day" in "data_date").
        expect(sql).toMatch(new RegExp(`\\b${col.name}\\b`));
      }
    });
  }
});
