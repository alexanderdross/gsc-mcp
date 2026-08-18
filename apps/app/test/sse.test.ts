import { describe, it, expect } from "vitest";
import {
  encodeSseEvent,
  encodeMessage,
  KEEPALIVE_COMMENT,
  SSE_KEEPALIVE_MS,
  SseStream,
  type SseSink,
  type IntervalTimer,
} from "../src/index.ts";

describe("SSE-Kodierung", () => {
  it("einzeilige Daten", () => {
    expect(encodeSseEvent("hallo")).toBe("data: hallo\n\n");
  });
  it("mehrzeilige Daten je Zeile mit data:", () => {
    expect(encodeSseEvent("a\nb")).toBe("data: a\ndata: b\n\n");
  });
  it("mit id und event", () => {
    expect(encodeSseEvent("x", { id: "1", event: "msg" })).toBe("id: 1\nevent: msg\ndata: x\n\n");
  });
  it("encodeMessage serialisiert JSON-RPC", () => {
    expect(encodeMessage({ jsonrpc: "2.0", id: 1, result: {} })).toBe(
      'data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n',
    );
  });
  it("Keepalive ist ein Kommentar", () => {
    expect(KEEPALIVE_COMMENT).toBe(": ping\n\n");
  });
});

function fakeSink(): SseSink & { chunks: string[]; closed: boolean } {
  const sink = {
    chunks: [] as string[],
    closed: false,
    write(chunk: string) {
      sink.chunks.push(chunk);
    },
    close() {
      sink.closed = true;
    },
  };
  return sink;
}

function fakeTimer(): IntervalTimer & { fire: () => void; ms?: number; cleared: boolean } {
  let fn: (() => void) | undefined;
  const timer = {
    ms: undefined as number | undefined,
    cleared: false,
    set(f: () => void, ms: number) {
      fn = f;
      timer.ms = ms;
      return 1;
    },
    clear() {
      timer.cleared = true;
      fn = undefined;
    },
    fire() {
      fn?.();
    },
  };
  return timer;
}

describe("SseStream", () => {
  it("sendet Nachrichten als Ereignisse mit fortlaufender id", () => {
    const sink = fakeSink();
    const stream = new SseStream(sink, { timer: fakeTimer() });
    stream.send({ a: 1 });
    stream.send({ b: 2 });
    expect(sink.chunks).toEqual(['id: 1\ndata: {"a":1}\n\n', 'id: 2\ndata: {"b":2}\n\n']);
  });

  it("armiert den Keepalive auf 30 s und pingt beim Feuern", () => {
    const sink = fakeSink();
    const timer = fakeTimer();
    const stream = new SseStream(sink, { timer });
    stream.start();
    expect(timer.ms).toBe(SSE_KEEPALIVE_MS);
    timer.fire();
    expect(sink.chunks).toEqual([KEEPALIVE_COMMENT]);
  });

  it("close räumt den Keepalive ab und schließt den Sink; danach wirkungslos", () => {
    const sink = fakeSink();
    const timer = fakeTimer();
    const stream = new SseStream(sink, { timer });
    stream.start();
    stream.close();
    expect(timer.cleared).toBe(true);
    expect(sink.closed).toBe(true);
    expect(stream.closed).toBe(true);

    stream.send({ x: 1 });
    stream.ping();
    timer.fire(); // Timer wurde abgeräumt
    expect(sink.chunks).toEqual([]); // nichts mehr geschrieben
  });
});
