/**
 * Request-Kontext ([docs/01], [docs/08]). Trägt die authentifizierte Identität durch die
 * asynchrone Aufrufkette, ohne sie durch jede Signatur zu fädeln — der GSC-Client löst so
 * den richtigen Google-Token je Nutzer auf, obwohl die Registry ein Singleton ist.
 * `AsyncLocalStorage` hält den Kontext pro Request sauber getrennt.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  readonly userId: number;
  readonly propertyId?: number;
  readonly plan: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Führt `fn` mit gesetztem Request-Kontext aus. */
export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Aktueller Kontext oder `undefined`, wenn außerhalb eines Requests. */
export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Nutzer-ID des aktuellen Requests; wirft außerhalb eines Kontexts. */
export function currentUserId(): number {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("Kein Request-Kontext gesetzt.");
  return ctx.userId;
}
