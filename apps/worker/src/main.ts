/**
 * Sync-Worker-Einstiegspunkt ([docs/04]). Konsumiert die Massen-Inspektions-Queue aus
 * pg-boss und führt je URL eine Live-Inspektion aus (GSC-Client + Cache/Budget über den
 * `IndexingRepository`). Bewusst dünn — die Bausteine sind aus `@gsc/app` wiederverwendet.
 *
 * Ohne Request-Kontext (kein HTTP hier) wird der Nutzer je Property aufgelöst und der
 * Kontext für die per-Nutzer-Token-Auflösung gesetzt.
 */

import { pathToFileURL } from "node:url";
import PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@gsc/db";
import { GscClient } from "@gsc/gsc-client";
import {
  loadConfig,
  GoogleOAuth,
  GoogleTokenProvider,
  dbCredentialSource,
  IndexingRepository,
  withRequestContext,
  currentUserId,
  startInspectionConsumer,
  type InspectionQueue,
  type InspectionJob,
} from "@gsc/app";

/** Löst den Eigentümer einer Property auf (für den Token-Kontext). */
async function ownerOf(db: Db, propertyId: number): Promise<number | null> {
  const [row] = await db
    .select({ userId: schema.properties.userId })
    .from(schema.properties)
    .where(eq(schema.properties.id, propertyId))
    .limit(1);
  return row?.userId ?? null;
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  const config = loadConfig(env);
  const { db } = createDb({ url: config.databaseUrl });

  const google = new GoogleOAuth({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: config.google.redirectUri,
  });
  const tokenProvider = new GoogleTokenProvider({
    refresher: google,
    credentials: dbCredentialSource(db),
    encryptionKey: config.encryptionKey,
  });
  const gsc = new GscClient({ tokenProvider: () => tokenProvider.forUser(currentUserId()) });
  // Der Worker konsumiert nur; die enqueue-Seite bleibt ungenutzt.
  const noopQueue: InspectionQueue = { async enqueue() {} };
  const indexing = new IndexingRepository({ db, client: gsc, queue: noopQueue });

  const boss = new PgBoss(config.databaseUrl);
  await boss.start();

  await startInspectionConsumer(boss, async (job: InspectionJob) => {
    const userId = await ownerOf(db, job.propertyId);
    if (userId === null) return; // Property verschwunden
    await withRequestContext({ userId, plan: "internal" }, async () => {
      for (const url of job.urls) {
        try {
          await indexing.inspect(job.propertyId, url, true);
        } catch {
          // Einzelne Fehler stoppen die Charge nicht; pg-boss-Retry greift job-weit.
        }
      }
    });
  });

  // eslint-disable-next-line no-console — Startmeldung des Workers
  console.log("gsc-mcp Sync-Worker läuft (Queue: inspect-urls).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console — Startfehler
    console.error(err);
    process.exitCode = 1;
  });
}
