/**
 * Kontext- und Export-Tools ([docs/05]). `get_google_updates` ist selbstständig
 * (gepflegter Katalog, keine I/O); `export_data` serialisiert Warehouse-Daten und
 * legt sie über einen injizierten Speicher als präsignierte URL ab — nicht durch
 * das Kontextfenster.
 */

import { z } from "zod";
import { defineTool } from "../tool.ts";
import { GOOGLE_UPDATES, googleUpdatesBetween } from "../google-updates.ts";
import { toCsv } from "../csv.ts";
import type { WarehouseRepo } from "../repo.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");

/** Verschiebt ein ISO-Datum um Tage (für den Standardzeitraum). */
function addDays(date: Date, days: number): string {
  const d = new Date(date.getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export const getGoogleUpdates = defineTool({
  name: "get_google_updates",
  annotations: { title: "Google-Updates", readOnlyHint: true },
  input: z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      type: z.enum(["core", "spam", "discover", "other"]).optional(),
    })
    .strict(),
  requires: {},
  async handler(_ctx, input) {
    const today = new Date();
    const to = input.to ?? today.toISOString().slice(0, 10);
    const from = input.from ?? addDays(today, -365);
    return { from, to, updates: googleUpdatesBetween(GOOGLE_UPDATES, from, to, input.type) };
  },
});

export interface StoredExport {
  readonly url: string;
  readonly expiresAt: string;
}

/** Legt eine Exportdatei ab und liefert eine präsignierte URL (R2/Objektspeicher). */
export interface ExportStore {
  put(name: string, contentType: string, body: string): Promise<StoredExport>;
}

export function makeExportData(repo: WarehouseRepo, store: ExportStore) {
  return defineTool({
    name: "export_data",
    annotations: { title: "Daten exportieren", readOnlyHint: true },
    input: z
      .object({
        dataset: z.enum(["query", "page", "query_page", "totals"]),
        from: isoDate,
        to: isoDate,
        // Parquet folgt über den Worker-Exportpfad; hier zunächst CSV.
        format: z.literal("csv").default("csv"),
      })
      .strict(),
    // Export ab Starter ([docs/07]).
    requires: { needsProperty: true, minPlan: "starter" },
    async handler(ctx, input) {
      const rows = await repo.exportDataset(ctx.propertyId!, input.dataset, {
        from: input.from,
        to: input.to,
      });
      const csv = toCsv(rows);
      const name = `${ctx.propertyId}_${input.dataset}_${input.from}_${input.to}.csv`;
      const stored = await store.put(name, "text/csv", csv);
      return {
        dataset: input.dataset,
        rows: rows.length,
        format: "csv",
        url: stored.url,
        expiresAt: stored.expiresAt,
      };
    },
  });
}
