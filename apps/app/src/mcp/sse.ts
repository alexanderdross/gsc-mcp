/**
 * Server-Sent-Events für den MCP-Streaming-Pfad ([docs/01]). Reine Bausteine: die
 * Kodierung der JSON-RPC-Nachrichten als SSE-`data:`-Ereignisse und der Keepalive, den
 * Cloudflares Idle-Timeout (900 s) erzwingt — **alle 30 s ein Kommentar `: ping`**,
 * sonst reißen ruhige Sitzungen ab. Das eigentliche Schreiben auf den Socket macht die
 * `node:http`-Schale über einen injizierten `SseSink`; der Zeitgeber ist ebenfalls
 * injizierbar, damit der Keepalive ohne echte Uhr prüfbar ist.
 */

/** Keepalive-Intervall: deutlich unter Cloudflares 900-s-Idle-Timeout ([docs/01]). */
export const SSE_KEEPALIVE_MS = 30_000;

/** SSE-Kommentar als Keepalive — vom Client ignoriert, hält aber die Verbindung wach. */
export const KEEPALIVE_COMMENT = ": ping\n\n";

/** Antwort-Header des Streaming-Pfads: kein Caching, keine Transformation ([docs/01]). */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

/** Kodiert Daten als ein SSE-Ereignis; mehrzeilige Daten werden je Zeile mit `data:` versehen. */
export function encodeSseEvent(data: string, opts: { id?: string; event?: string } = {}): string {
  const lines: string[] = [];
  if (opts.id !== undefined) lines.push(`id: ${opts.id}`);
  if (opts.event !== undefined) lines.push(`event: ${opts.event}`);
  for (const line of data.split("\n")) lines.push(`data: ${line}`);
  return `${lines.join("\n")}\n\n`;
}

/** Kodiert eine JSON-RPC-Nachricht als SSE-Ereignis. */
export function encodeMessage(message: unknown, opts: { id?: string; event?: string } = {}): string {
  return encodeSseEvent(JSON.stringify(message), opts);
}

/** Ziel, auf das der Strom schreibt (von der node:http-Schale erfüllt). */
export interface SseSink {
  write(chunk: string): void;
  close(): void;
}

/** Zeitgeber-Abstraktion — Vorgabe sind die globalen Timer, in Tests injiziert. */
export interface IntervalTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const GLOBAL_TIMER: IntervalTimer = {
  set: (fn, ms) => setInterval(fn, ms),
  clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface SseStreamOptions {
  readonly timer?: IntervalTimer;
  readonly keepaliveMs?: number;
}

/**
 * Ein laufender SSE-Strom: sendet Nachrichten als Ereignisse mit fortlaufender `id` und
 * hält die Verbindung per Keepalive wach. `start()` armiert den Keepalive, `close()`
 * räumt ihn ab — nach dem Schließen sind `send`/`ping` wirkungslos.
 */
export class SseStream {
  readonly #sink: SseSink;
  readonly #timer: IntervalTimer;
  readonly #keepaliveMs: number;
  #handle: unknown;
  #closed = false;
  #nextId = 0;

  constructor(sink: SseSink, opts: SseStreamOptions = {}) {
    this.#sink = sink;
    this.#timer = opts.timer ?? GLOBAL_TIMER;
    this.#keepaliveMs = opts.keepaliveMs ?? SSE_KEEPALIVE_MS;
  }

  /** Armiert den Keepalive. Ohne Aufruf fließt kein Ping. */
  start(): void {
    if (this.#closed || this.#handle !== undefined) return;
    this.#handle = this.#timer.set(() => this.ping(), this.#keepaliveMs);
  }

  /** Sendet eine JSON-RPC-Nachricht als SSE-Ereignis (mit fortlaufender id). */
  send(message: unknown): void {
    if (this.#closed) return;
    this.#sink.write(encodeMessage(message, { id: String(++this.#nextId) }));
  }

  /** Sendet einen Keepalive-Kommentar. */
  ping(): void {
    if (this.#closed) return;
    this.#sink.write(KEEPALIVE_COMMENT);
  }

  /** Beendet den Strom: Keepalive abräumen, Sink schließen. Idempotent. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#handle !== undefined) {
      this.#timer.clear(this.#handle);
      this.#handle = undefined;
    }
    this.#sink.close();
  }

  get closed(): boolean {
    return this.#closed;
  }
}
