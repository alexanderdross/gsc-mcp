/**
 * MCP-Sitzungszustand ([docs/01]). Der Streamable-HTTP-Transport schlüsselt nach
 * `Mcp-Session-Id`; hier liegt der zugehörige Kontext (Plan, Nutzer, gewählte Property).
 * Die In-Memory-Variante genügt im Prozess; für Neustart-Festigkeit spiegelt die echte
 * Implementierung zusätzlich nach `core.mcp_sessions` — dieselbe Schnittstelle, anderer
 * Speicher.
 */

import { randomUUID } from "node:crypto";
import type { Session } from "../router.ts";

export interface McpSession {
  readonly id: string; // Mcp-Session-Id
  readonly session: Session; // Router-Kontext
  readonly initialized: boolean;
}

export interface SessionStore {
  /** Legt eine Sitzung an und vergibt eine `Mcp-Session-Id`. */
  create(session: Session): Promise<McpSession>;
  get(id: string): Promise<McpSession | undefined>;
  /** Setzt die gewählte Property (Basis für ein späteres `select_property`). */
  setProperty(id: string, propertyId: number): Promise<void>;
  /** Merkt die abgeschlossene `initialize`-Handshake-Phase. */
  markInitialized(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Prozesslokaler Speicher; injizierbarer ID-Generator für deterministische Tests. */
export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, McpSession>();
  readonly #newId: () => string;

  constructor(newId: () => string = randomUUID) {
    this.#newId = newId;
  }

  async create(session: Session): Promise<McpSession> {
    const id = this.#newId();
    const mcp: McpSession = { id, session, initialized: false };
    this.#sessions.set(id, mcp);
    return mcp;
  }

  async get(id: string): Promise<McpSession | undefined> {
    return this.#sessions.get(id);
  }

  async setProperty(id: string, propertyId: number): Promise<void> {
    const current = this.#sessions.get(id);
    if (!current) return;
    this.#sessions.set(id, { ...current, session: { ...current.session, propertyId } });
  }

  async markInitialized(id: string): Promise<void> {
    const current = this.#sessions.get(id);
    if (!current || current.initialized) return;
    this.#sessions.set(id, { ...current, initialized: true });
  }

  async delete(id: string): Promise<void> {
    this.#sessions.delete(id);
  }
}
