import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildRegistry,
  Router,
  // MCP-Gerüst
  jsonSchemaFromZod,
  asRequest,
  isNotification,
  toolDescriptor,
  callToolResult,
  McpServer,
  McpEndpoint,
  InMemorySessionStore,
  MCP_PROTOCOL_VERSION,
  type Session,
  type JsonRpcRequest,
} from "../src/index.ts";

const owns = async () => true;
const freeSession: Session = { plan: "free", userId: 1, detail: "standard" };

function server() {
  return new McpServer(buildRegistry(), new Router(buildRegistry(), { ownershipCheck: owns }));
}

describe("jsonSchemaFromZod", () => {
  const schema = z
    .object({
      dimension: z.enum(["query", "page"]).default("query"),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      url: z.string().url().optional(),
      limit: z.number().int().positive().optional(),
      confirm: z.literal(true),
    })
    .strict();
  const js = jsonSchemaFromZod(schema);
  const props = js.properties as Record<string, Record<string, unknown>>;

  it("erzeugt ein geschlossenes Objekt-Schema", () => {
    expect(js.type).toBe("object");
    expect(js.additionalProperties).toBe(false);
  });

  it("erfordert nur Felder ohne default/optional", () => {
    expect(js.required).toEqual(["from", "confirm"]);
  });

  it("bildet enum, default, regex, url und positive int ab", () => {
    expect(props.dimension!.enum).toEqual(["query", "page"]);
    expect(props.dimension!.default).toBe("query");
    expect(props.from!.pattern).toBe("^\\d{4}-\\d{2}-\\d{2}$");
    expect(props.url!.format).toBe("uri");
    expect(props.limit!.type).toBe("integer");
    expect(props.limit!.exclusiveMinimum).toBe(0);
    expect(props.confirm!).toEqual({ type: "boolean", const: true });
  });

  it("liefert für echte Tools ein Objekt-Schema", () => {
    const d = toolDescriptor(buildRegistry().get("get_google_updates")!);
    expect(d.inputSchema.type).toBe("object");
    expect((d.inputSchema.properties as Record<string, unknown>).type).toBeDefined();
  });
});

describe("JSON-RPC-Hilfen", () => {
  it("erkennt Notifications an fehlender id", () => {
    expect(isNotification({ jsonrpc: "2.0", method: "notifications/initialized" })).toBe(true);
    expect(isNotification({ jsonrpc: "2.0", id: 1, method: "ping" })).toBe(false);
  });
  it("validiert den Umschlag", () => {
    expect(asRequest({ jsonrpc: "2.0", id: 1, method: "ping" })).not.toBeNull();
    expect(asRequest({ jsonrpc: "1.0", method: "x" })).toBeNull();
    expect(asRequest({ method: "x" })).toBeNull();
    expect(asRequest("nope")).toBeNull();
  });
});

describe("callToolResult", () => {
  it("ok → Inhalt ohne isError", () => {
    const r = callToolResult({ kind: "ok", output: { a: 1 } });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]!.text)).toEqual({ a: 1 });
  });
  it("denied/error → isError mit wörtlicher Meldung", () => {
    expect(callToolResult({ kind: "denied", message: "Upgrade nötig" })).toEqual({
      content: [{ type: "text", text: "Upgrade nötig" }],
      isError: true,
    });
    expect(callToolResult({ kind: "error", message: "kaputt" }).isError).toBe(true);
  });
});

describe("McpServer.receive", () => {
  it("initialize meldet Protokollversion und Server-Info", async () => {
    const res = await server().receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, freeSession);
    expect(res).not.toBeNull();
    const result = (res as { result: Record<string, unknown> }).result;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect((result.serverInfo as { name: string }).name).toBe("gsc-mcp");
  });

  it("tools/list liefert die registrierten Tools mit inputSchema", async () => {
    const res = await server().receive({ jsonrpc: "2.0", id: 2, method: "tools/list" }, freeSession);
    const tools = (res as { result: { tools: Array<{ name: string; inputSchema: unknown }> } }).result.tools;
    expect(tools.map((t) => t.name)).toContain("get_google_updates");
    expect(tools.every((t) => t.inputSchema && typeof t.inputSchema === "object")).toBe(true);
  });

  it("tools/call führt aus und verpackt das Ergebnis", async () => {
    const res = await server().receive(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_google_updates", arguments: { from: "2025-01-01", to: "2025-12-31" } },
      },
      freeSession,
    );
    const result = (res as { result: { content: Array<{ text: string }>; isError?: boolean } }).result;
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toHaveProperty("updates");
  });

  it("tools/call auf ein unbekanntes Tool → isError", async () => {
    const res = await server().receive(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "gibt_es_nicht" } },
      freeSession,
    );
    expect((res as { result: { isError?: boolean } }).result.isError).toBe(true);
  });

  it("tools/call ohne name → InvalidParams", async () => {
    const res = await server().receive({ jsonrpc: "2.0", id: 5, method: "tools/call", params: {} }, freeSession);
    expect((res as { error: { code: number } }).error.code).toBe(-32602);
  });

  it("unbekannte Methode → MethodNotFound", async () => {
    const res = await server().receive({ jsonrpc: "2.0", id: 6, method: "foo/bar" }, freeSession);
    expect((res as { error: { code: number } }).error.code).toBe(-32601);
  });

  it("Notification liefert keine Antwort", async () => {
    const res = await server().receive({ jsonrpc: "2.0", method: "notifications/initialized" }, freeSession);
    expect(res).toBeNull();
  });
});

describe("InMemorySessionStore", () => {
  it("legt an, liest, setzt Property, markiert initialisiert und löscht", async () => {
    let n = 0;
    const store = new InMemorySessionStore(() => `sess-${++n}`);
    const mcp = await store.create(freeSession);
    expect(mcp.id).toBe("sess-1");
    expect((await store.get("sess-1"))?.session.propertyId).toBeUndefined();

    await store.setProperty("sess-1", 7);
    expect((await store.get("sess-1"))?.session.propertyId).toBe(7);

    await store.markInitialized("sess-1");
    expect((await store.get("sess-1"))?.initialized).toBe(true);

    await store.delete("sess-1");
    expect(await store.get("sess-1")).toBeUndefined();
  });
});

describe("McpEndpoint (POST /mcp)", () => {
  function endpoint(session: Session | null = freeSession) {
    let n = 0;
    const store = new InMemorySessionStore(() => `sess-${++n}`);
    const srv = new McpServer(buildRegistry(), new Router(buildRegistry(), { ownershipCheck: owns }));
    return new McpEndpoint({ server: srv, store, authenticate: async () => session });
  }

  const body = (msg: JsonRpcRequest) => JSON.stringify(msg);

  it("initialize vergibt eine Mcp-Session-Id im Header", async () => {
    const res = await endpoint().post(body({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    expect(res.status).toBe(200);
    expect(res.headers["mcp-session-id"]).toBe("sess-1");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("folgender Aufruf braucht die Session-Id und funktioniert damit", async () => {
    const ep = endpoint();
    await ep.post(body({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    const ok = await ep.post(body({ jsonrpc: "2.0", id: 2, method: "tools/list" }), {
      "Mcp-Session-Id": "sess-1",
    });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).result.tools.length).toBeGreaterThan(0);
  });

  it("ohne Session-Id → 400", async () => {
    const res = await endpoint().post(body({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    expect(res.status).toBe(400);
  });

  it("unbekannte Session → 404", async () => {
    const res = await endpoint().post(body({ jsonrpc: "2.0", id: 2, method: "ping" }), {
      "mcp-session-id": "fremd",
    });
    expect(res.status).toBe(404);
  });

  it("nicht authentifiziert → 401", async () => {
    const res = await endpoint(null).post(body({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    expect(res.status).toBe(401);
  });

  it("Batch (Array) → 400", async () => {
    const res = await endpoint().post("[]");
    expect(res.status).toBe(400);
  });

  it("kaputtes JSON → 400 ParseError", async () => {
    const res = await endpoint().post("{nope");
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe(-32700);
  });

  it("Notification → 202 ohne Body", async () => {
    const ep = endpoint();
    await ep.post(body({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    const res = await ep.post(body({ jsonrpc: "2.0", method: "notifications/initialized" }), {
      "mcp-session-id": "sess-1",
    });
    expect(res.status).toBe(202);
    expect(res.body).toBe("");
  });
});
