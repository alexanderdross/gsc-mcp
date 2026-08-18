/**
 * Einstiegspunkt ([docs/01]). Liest die Konfiguration aus der Umgebung, öffnet die
 * Datenbank, verdrahtet die Anwendung (`buildApp`) und startet den HTTP-Server. Bewusst
 * dünn — die gesamte Logik liegt testbar in `buildApp` und den Bausteinen darunter.
 *
 * Die Massen-Inspektions-Queue ist hier noch ein No-op; der pg-boss-Adapter tritt an
 * ihre Stelle, sobald der Worker läuft. Der SSE-Strom (`startSseStream`) steht bereit;
 * der Anfrage-Antwort-Verkehr läuft über den JSON-Pfad.
 */

import { pathToFileURL } from "node:url";
import { createDb } from "@gsc/db";
import { loadConfig } from "./config.ts";
import { buildApp } from "./app.ts";
import { GoogleOAuth } from "./oauth/index.ts";
import { createHttpServer } from "./http/index.ts";
import type { InspectionQueue } from "./indexing-repo.ts";

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  const config = loadConfig(env);
  const { db } = createDb({ url: config.databaseUrl });
  const google = new GoogleOAuth({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: config.google.redirectUri,
  });
  // Platzhalter, bis der pg-boss-Adapter verdrahtet ist.
  const queue: InspectionQueue = { async enqueue() {} };

  const app = buildApp({ db, google, config, queue });
  const server = createHttpServer(app.router);
  server.listen(config.port, () => {
    // eslint-disable-next-line no-console — Startmeldung des Servers
    console.log(`gsc-mcp hört auf :${config.port} (issuer ${config.issuer})`);
  });
}

// Nur ausführen, wenn direkt gestartet (nicht beim Import in Tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console — Startfehler
    console.error(err);
    process.exitCode = 1;
  });
}
