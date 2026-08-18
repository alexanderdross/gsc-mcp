import { describe, it, expect } from "vitest";
import type { Fact } from "@gsc/core";
import {
  buildRegistry,
  Router,
  GOOGLE_UPDATES,
  googleUpdatesBetween,
  toCsv,
  type Session,
  type WarehouseRepo,
  type ExportStore,
  type ExportDataset,
  type Period,
  type ExportRow,
} from "../src/index.ts";

function fact(clicks: number, impressions: number, position: number): Fact {
  return { clicks, impressions, positionSum: position * impressions };
}

/** Fake-Repo, das einen festen Datensatz für den Export zurückgibt. */
function fakeRepo(rows: readonly ExportRow[]): WarehouseRepo & { lastExport?: { dataset: ExportDataset; period: Period } } {
  const repo: WarehouseRepo & { lastExport?: { dataset: ExportDataset; period: Period } } = {
    async performance(q) {
      return { rows: [], totals: fact(0, 0, 0), anonymizedImpressions: 0, source: "warehouse", covered: q.period };
    },
    async segmentPairs() {
      return [];
    },
    async timeseries() {
      return [];
    },
    async cannibalizationRows() {
      return [];
    },
    async decayInputs() {
      return { pages: [], siteYoy: 0 };
    },
    async exportDataset(_p, dataset, period) {
      repo.lastExport = { dataset, period };
      return rows;
    },
  };
  return repo;
}

/** Fake-Objektspeicher: merkt sich den Körper und liefert eine „präsignierte" URL. */
function fakeStore(): ExportStore & { lastBody?: string; lastName?: string } {
  const store: ExportStore & { lastBody?: string; lastName?: string } = {
    async put(name, _contentType, body) {
      store.lastName = name;
      store.lastBody = body;
      return { url: `https://r2.example/${name}?sig=abc`, expiresAt: "2026-08-19T00:00:00Z" };
    },
  };
  return store;
}

const owns = async () => true;

describe("googleUpdatesBetween", () => {
  it("liefert nur Updates, die sich mit dem Zeitraum überschneiden, sortiert nach Start", () => {
    const res = googleUpdatesBetween(GOOGLE_UPDATES, "2024-08-01", "2024-12-31");
    const names = res.map((u) => u.name);
    // August-, November-, Dezember-Updates 2024 liegen im Fenster.
    expect(names).toContain("August 2024 Core Update");
    expect(names).toContain("November 2024 Core Update");
    expect(names).not.toContain("March 2024 Core Update");
    // aufsteigend nach Startdatum
    const starts = res.map((u) => u.start);
    expect(starts).toEqual([...starts].sort());
  });

  it("filtert nach Typ", () => {
    const spam = googleUpdatesBetween(GOOGLE_UPDATES, "2024-01-01", "2025-12-31", "spam");
    expect(spam.every((u) => u.type === "spam")).toBe(true);
    expect(spam.length).toBeGreaterThan(0);
  });

  it("behandelt ein Update ohne Enddatum als eintägig", () => {
    const updates = [{ name: "Punkt-Update", type: "other" as const, start: "2025-05-10" }];
    expect(googleUpdatesBetween(updates, "2025-05-10", "2025-05-10")).toHaveLength(1);
    expect(googleUpdatesBetween(updates, "2025-05-11", "2025-05-20")).toHaveLength(0);
  });
});

describe("get_google_updates", () => {
  it("ist ohne Property und ohne Repo registriert und liefert Updates im Zeitraum", async () => {
    const router = new Router(buildRegistry(), { ownershipCheck: owns });
    const session: Session = { plan: "free", userId: 1, detail: "standard" };
    const res = await router.run(session, "get_google_updates", {
      from: "2025-01-01",
      to: "2025-12-31",
      type: "core",
    });
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    const out = res.output as {
      from: string;
      to: string;
      updates: Array<{ name: string; type: string }>;
    };
    expect(out.from).toBe("2025-01-01");
    expect(out.to).toBe("2025-12-31");
    expect(out.updates.length).toBeGreaterThan(0);
    expect(out.updates.every((u) => u.type === "core")).toBe(true);
  });
});

describe("toCsv", () => {
  it("quotet Felder mit Komma und verdoppelt innere Anführungszeichen", () => {
    const csv = toCsv([{ a: 'x,"y"', b: 1 }]);
    expect(csv).toBe('a,b\n"x,""y""",1');
  });

  it("liefert leeren String bei leerer Eingabe", () => {
    expect(toCsv([])).toBe("");
  });
});

describe("export_data", () => {
  const rows: ExportRow[] = [
    { query: "aip", clicks: 98, impressions: 20898 },
    { query: "aip germany", clicks: 109, impressions: 729 },
  ];

  it("serialisiert das Dataset und legt es als präsignierte URL ab", async () => {
    const repo = fakeRepo(rows);
    const store = fakeStore();
    const router = new Router(buildRegistry({ repo, exportStore: store }), { ownershipCheck: owns });
    const session: Session = { plan: "starter", userId: 1, propertyId: 7, detail: "standard" };

    const res = await router.run(session, "export_data", {
      dataset: "query",
      from: "2026-08-01",
      to: "2026-08-16",
    });
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    const out = res.output as { dataset: string; rows: number; format: string; url: string; expiresAt: string };
    expect(out.dataset).toBe("query");
    expect(out.rows).toBe(2);
    expect(out.format).toBe("csv");
    expect(out.url).toContain("https://r2.example/");
    expect(out.expiresAt).toBe("2026-08-19T00:00:00Z");
    expect(repo.lastExport).toEqual({ dataset: "query", period: { from: "2026-08-01", to: "2026-08-16" } });
    // Der abgelegte Körper ist das CSV der Zeilen.
    expect(store.lastBody).toBe(toCsv(rows));
    expect(store.lastName).toContain("query");
  });

  it("verlangt eine ausgewählte Property", async () => {
    const router = new Router(buildRegistry({ repo: fakeRepo(rows), exportStore: fakeStore() }), {
      ownershipCheck: owns,
    });
    const res = await router.run({ plan: "starter", userId: 1, detail: "standard" }, "export_data", {
      dataset: "query",
      from: "2026-08-01",
      to: "2026-08-16",
    });
    expect(res.kind).toBe("denied");
  });

  it("ist für Free gesperrt (Export ab Starter)", async () => {
    const router = new Router(buildRegistry({ repo: fakeRepo(rows), exportStore: fakeStore() }), {
      ownershipCheck: owns,
    });
    const res = await router.run({ plan: "free", userId: 1, propertyId: 7, detail: "standard" }, "export_data", {
      dataset: "query",
      from: "2026-08-01",
      to: "2026-08-16",
    });
    expect(res.kind).toBe("denied");
  });

  it("wird ohne Objektspeicher nicht registriert", () => {
    const repo = fakeRepo(rows);
    expect(buildRegistry({ repo }).get("export_data")).toBeUndefined();
    expect(buildRegistry({ repo, exportStore: fakeStore() }).get("export_data")).toBeDefined();
  });
});
