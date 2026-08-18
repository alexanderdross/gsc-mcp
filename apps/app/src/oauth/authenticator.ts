/**
 * Bearer-Authentifikator ([docs/02]) — schließt die Schleife zum MCP-Transport: Er
 * bildet die `Authorization: Bearer …`-Kopfzeile auf eine Router-`Session` ab. Der
 * MCP-Endpunkt ruft ihn beim `initialize` auf. Prüft Ablauf und — sofern gesetzt — die
 * Zielressource (RFC 8707), damit ein für einen anderen Server ausgestelltes Token hier
 * nicht greift.
 */

import type { Plan } from "@gsc/core";
import type { Session } from "../router.ts";
import type { Authenticator } from "../mcp/transport.ts";
import type { TokenStore } from "./store.ts";

/** Löst den Plan eines Nutzers auf (später aus der Subscription; injizierbar für Tests). */
export type PlanResolver = (userId: number) => Promise<Plan>;

export interface BearerAuthConfig {
  readonly tokenStore: TokenStore;
  readonly resolvePlan: PlanResolver;
  /** Erwartete Zielressource; passt sie nicht zum Token, wird abgelehnt. */
  readonly audience?: string;
  readonly now?: () => number;
}

const BEARER = /^Bearer[ ]+(.+)$/i;

export function makeBearerAuthenticator(cfg: BearerAuthConfig): Authenticator {
  const now = cfg.now ?? (() => Date.now());
  return async (headers) => {
    const header = headers["authorization"];
    if (!header) return null;
    const match = BEARER.exec(header.trim());
    if (!match) return null;
    const token = match[1]!.trim();

    const grant = await cfg.tokenStore.getAccess(token);
    if (!grant) return null;
    if (grant.expiresAt <= now()) return null;
    if (cfg.audience !== undefined && grant.audience !== undefined && grant.audience !== cfg.audience) {
      return null;
    }

    const plan = await cfg.resolvePlan(grant.userId);
    // propertyId wird nicht aus dem Token bezogen — sie kommt später aus der Sitzung
    // (select_property) und wird zentral im Router geprüft.
    const session: Session = { plan, userId: grant.userId };
    return session;
  };
}
