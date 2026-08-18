/**
 * pg-boss-Anbindung der Massen-Inspektions-Queue ([docs/04]). Der Produzent
 * (`PgBossInspectionQueue`) erfüllt die `InspectionQueue`-Schnittstelle, die der
 * `IndexingRepository` beim `bulk_inspect_urls` nutzt; der Konsument
 * (`startInspectionConsumer`) läuft im Worker. Beide sprechen über kleine strukturelle
 * Schnittstellen (`JobSender`/`JobWorker`), die pg-boss erfüllt — so bleibt die Logik
 * ohne laufende Queue testbar.
 */

import type { InspectionQueue } from "./indexing-repo.ts";

/** Name der Warteschlange in pg-boss. */
export const INSPECTION_QUEUE = "inspect-urls";

export interface InspectionJob {
  readonly propertyId: number;
  readonly urls: readonly string[];
}

/** Minimaler Produzent (pg-boss `send`). */
export interface JobSender {
  send(name: string, data: object): Promise<string | null>;
}

export interface JobBox<T> {
  readonly data: T;
}

/** Minimaler Konsument (pg-boss `work`). */
export interface JobWorker {
  work<T>(name: string, handler: (jobs: JobBox<T>[]) => Promise<void>): Promise<string>;
}

export class PgBossInspectionQueue implements InspectionQueue {
  readonly #sender: JobSender;

  constructor(sender: JobSender) {
    this.#sender = sender;
  }

  async enqueue(propertyId: number, urls: readonly string[]): Promise<void> {
    if (urls.length === 0) return;
    const job: InspectionJob = { propertyId, urls: [...urls] };
    await this.#sender.send(INSPECTION_QUEUE, job);
  }
}

export type InspectionHandler = (job: InspectionJob) => Promise<void>;

/** Registriert den Konsumenten: verarbeitet jede Job-Charge Zeile für Zeile. */
export async function startInspectionConsumer(worker: JobWorker, handle: InspectionHandler): Promise<void> {
  await worker.work<InspectionJob>(INSPECTION_QUEUE, async (jobs) => {
    for (const job of jobs) await handle(job.data);
  });
}
