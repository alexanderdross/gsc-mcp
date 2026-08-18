/**
 * Kompositionswurzel ([docs/01]). `buildApp` verdrahtet aus einer Datenbank, dem
 * Google-Adapter und der Konfiguration die gesamte Anwendung zu einem `HttpRouter`:
 * OAuth-Speicher und -Provider, den Warehouse-/Indexierungs-Zugriff, die Tool-Registry,
 * den MCP-Endpunkt und die Metadaten. Die externen Adapter (DB, Google, Queue) werden
 * injiziert, damit die Verdrahtung als Ganzes testbar bleibt.
 */

import { randomUUID } from "node:crypto";
import type { Db } from "@gsc/db";
import { WarehouseRepository } from "@gsc/db";
import { GscClient } from "@gsc/gsc-client";
import type { AppConfig } from "./config.ts";
import { buildRegistry } from "./index.ts";
import { IndexingRepository, type InspectionQueue } from "./indexing-repo.ts";
import { Router } from "./router.ts";
import { McpServer, McpEndpoint, InMemorySessionStore } from "./mcp/index.ts";
import { HttpRouter } from "./http/index.ts";
import { makeOwnershipCheck, makePlanResolver, currentUserId } from "./runtime/index.ts";
import type { ExportStore } from "./tools/context.ts";
import {
  OAuthProvider,
  DbClientStore,
  DbTokenStore,
  DbAuthCodeStore,
  DbPendingStore,
  DbUserDirectory,
  GoogleTokenProvider,
  dbCredentialSource,
  makeBearerAuthenticator,
  defaultGenerators,
  randomToken,
  authorizationServerMetadata,
  protectedResourceMetadata,
  type GoogleAuth,
  type GoogleTokenRefresher,
} from "./oauth/index.ts";

/** Der Google-Adapter erfüllt beide Rollen: Zustimmungs-/Code-Tausch und Token-Erneuerung. */
export type GoogleAdapter = GoogleAuth & GoogleTokenRefresher;

export interface AppDeps {
  readonly db: Db;
  readonly google: GoogleAdapter;
  readonly config: AppConfig;
  /** Warteschlange für die asynchrone Massen-Inspektion (pg-boss im Betrieb). */
  readonly queue: InspectionQueue;
  /** Objektspeicher für Exporte (R2). Fehlt er, wird `export_data` nicht registriert. */
  readonly exportStore?: ExportStore;
  /** ID-Generatoren; Vorgabe zufällig. In Tests injizierbar. */
  readonly newSessionId?: () => string;
}

export interface App {
  readonly router: HttpRouter;
  readonly mcp: McpEndpoint;
  readonly provider: OAuthProvider;
}

export function buildApp(deps: AppDeps): App {
  const { db, google, config } = deps;

  // OAuth-Speicher (persistent).
  const clients = new DbClientStore(db);
  const tokens = new DbTokenStore(db);
  const provider = new OAuthProvider({
    clients,
    codes: new DbAuthCodeStore(db),
    tokens,
    pending: new DbPendingStore(db),
    users: new DbUserDirectory({ db, encryptionKey: config.encryptionKey }),
    google,
    gen: defaultGenerators(),
    googleScopes: config.googleScopes,
  });

  // GSC-Client mit per-Nutzer-Token aus dem Request-Kontext.
  const tokenProvider = new GoogleTokenProvider({
    refresher: google,
    credentials: dbCredentialSource(db),
    encryptionKey: config.encryptionKey,
  });
  const gsc = new GscClient({ tokenProvider: () => tokenProvider.forUser(currentUserId()) });

  // Tool-Registry: Warehouse (Lesen/Export) + Indexierung (live GSC + DB-Cache + Budget).
  const warehouse = new WarehouseRepository(db);
  const indexing = new IndexingRepository({ db, client: gsc, queue: deps.queue });
  const registry = buildRegistry({
    repo: warehouse,
    indexing,
    ...(deps.exportStore ? { exportStore: deps.exportStore } : {}),
  });

  // MCP-Endpunkt mit zentraler Berechtigungs-/Mandantenprüfung.
  const router = new Router(registry, { ownershipCheck: makeOwnershipCheck(db) });
  const mcp = new McpEndpoint({
    server: new McpServer(registry, router),
    store: new InMemorySessionStore(deps.newSessionId ?? randomUUID),
    authenticate: makeBearerAuthenticator({
      tokenStore: tokens,
      resolvePlan: makePlanResolver(db),
      audience: config.resource,
    }),
  });

  const httpRouter = new HttpRouter({
    mcp,
    provider,
    registration: {
      store: clients,
      newClientId: () => `dcr_${randomToken(12)}`,
      newClientSecret: () => randomToken(24),
      now: () => Date.now(),
    },
    metadata: {
      authorizationServer: authorizationServerMetadata({
        issuer: config.issuer,
        scopesSupported: ["mcp"],
      }),
      protectedResource: protectedResourceMetadata({
        resource: config.resource,
        authorizationServers: [config.issuer],
        scopesSupported: ["mcp"],
      }),
    },
  });

  return { router: httpRouter, mcp, provider };
}
