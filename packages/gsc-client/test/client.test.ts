import { describe, it, expect } from "vitest";
import { GscClient, type FetchFn, type SearchAnalyticsRow } from "../src/index.ts";
import { paginate, collectAll } from "../src/index.ts";

function row(key: string): SearchAnalyticsRow {
  return { keys: [key], clicks: 1, impressions: 10, ctr: 0.1, position: 3 };
}

/** Baut eine gefälschte fetch-Funktion aus einer Reihe kanonischer Antworten. */
function fakeFetch(
  handler: (url: string, body: unknown, call: number) => { status: number; json: unknown },
): { fetchFn: FetchFn; calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, headers: init.headers });
    const { status, json } = handler(url, body, calls.length - 1);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    };
  };
  return { fetchFn, calls };
}

describe("GscClient", () => {
  it("setzt den Bearer-Token aus dem tokenProvider", async () => {
    const { fetchFn, calls } = fakeFetch(() => ({ status: 200, json: { siteEntry: [] } }));
    const client = new GscClient({ tokenProvider: async () => "tok-123", fetchFn });
    await client.listSites();
    expect(calls[0]!.headers["authorization"]).toBe("Bearer tok-123");
  });

  it("übersetzt einen 401 in einen GscError kind=invalid_grant", async () => {
    const { fetchFn } = fakeFetch(() => ({
      status: 401,
      json: { error: { message: "Invalid Credentials" } },
    }));
    const client = new GscClient({ tokenProvider: async () => "x", fetchFn });
    await expect(client.listSites()).rejects.toMatchObject({ kind: "invalid_grant" });
  });

  it("wiederholt einen 429 und liefert danach das Ergebnis", async () => {
    const { fetchFn, calls } = fakeFetch((_url, _body, call) =>
      call === 0
        ? { status: 429, json: { error: { message: "slow down" } } }
        : { status: 200, json: { rows: [row("a")] } },
    );
    const client = new GscClient({
      tokenProvider: async () => "x",
      fetchFn,
      retry: { sleep: async () => {} },
    });
    const rows = await client.querySearchAnalytics("sc-domain:example.com", {
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      dimensions: ["query"],
    });
    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("paginiert über mehrere Seiten bis zur Teilseite", async () => {
    const client = new GscClient({ tokenProvider: async () => "x", fetchFn: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }) });
    // Direkt die Pagination gegen einen Fake-Seitenabruf prüfen (pageSize 2).
    const pages = [
      [row("a"), row("b")],
      [row("c"), row("d")],
      [row("e")], // Teilseite ⇒ Ende
    ];
    const seenStartRows: number[] = [];
    const all = await collectAll(async (startRow, size) => {
      seenStartRows.push(startRow);
      expect(size).toBe(2);
      return pages[startRow / 2] ?? [];
    }, 2);
    expect(all.map((r) => r.keys[0])).toEqual(["a", "b", "c", "d", "e"]);
    expect(seenStartRows).toEqual([0, 2, 4]);
    void client;
  });

  it("liefert die Seiten einzeln mit fortschreitendem Cursor", async () => {
    const pages = [[row("a"), row("b")], [row("c")]];
    const emitted: number[] = [];
    for await (const page of paginate(async (startRow) => pages[startRow / 2] ?? [], 2)) {
      emitted.push(page.startRow);
    }
    expect(emitted).toEqual([0, 2]);
  });
});
