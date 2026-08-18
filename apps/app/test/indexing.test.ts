import { describe, it, expect } from "vitest";
import {
  planInspectionBatch,
  summarizeCoverage,
  directoryOf,
  buildRegistry,
  Router,
  type IndexingRepo,
  type InspectionRecord,
  type Sitemap,
} from "../src/index.ts";

describe("planInspectionBatch", () => {
  const urls = ["a", "b", "c", "d", "e"];

  it("plant so viele wie Budget zulässt und stellt den Rest zurück", () => {
    expect(planInspectionBatch(urls, 3)).toEqual({ planned: ["a", "b", "c"], deferred: 2 });
  });
  it("respektiert maxUrls zusätzlich zum Budget", () => {
    expect(planInspectionBatch(urls, 10, 2)).toEqual({ planned: ["a", "b"], deferred: 3 });
  });
  it("plant nichts bei erschöpftem Budget", () => {
    expect(planInspectionBatch(urls, 0)).toEqual({ planned: [], deferred: 5 });
  });
});

describe("summarizeCoverage", () => {
  const records: InspectionRecord[] = [
    { url: "https://x/a", verdict: "PASS", coverageState: "Submitted and indexed" },
    { url: "https://x/blog/1", verdict: "FAIL", coverageState: "Crawled - not indexed" },
    { url: "https://x/blog/2", verdict: "PASS" },
    { url: "https://x/", verdict: "PASS", coverageState: "Submitted and indexed" },
  ];

  it("gruppiert nach Verdict, absteigend nach Häufigkeit", () => {
    expect(summarizeCoverage(records, "verdict")).toEqual([
      { key: "PASS", count: 3 },
      { key: "FAIL", count: 1 },
    ]);
  });
  it("weist fehlende Werte als 'unbekannt' aus", () => {
    const buckets = summarizeCoverage(records, "coverage_state");
    expect(buckets.find((b) => b.key === "unbekannt")?.count).toBe(1);
  });
  it("gruppiert nach Verzeichnis", () => {
    const buckets = summarizeCoverage(records, "directory");
    expect(buckets.find((b) => b.key === "/blog")?.count).toBe(2);
    expect(buckets.find((b) => b.key === "/")?.count).toBe(1);
  });
  it("directoryOf nimmt das erste Pfadsegment", () => {
    expect(directoryOf("https://x/blog/post")).toBe("/blog");
    expect(directoryOf("https://x/")).toBe("/");
    expect(directoryOf("kaputt")).toBe("/");
  });
});

function fakeIndexing(over: Partial<IndexingRepo> = {}): IndexingRepo & { enqueued: string[] } {
  const state = { enqueued: [] as string[] };
  const repo: IndexingRepo & { enqueued: string[] } = {
    enqueued: state.enqueued,
    async inspect(_p, url, forceRefresh) {
      return { url, verdict: forceRefresh ? "PARTIAL" : "PASS" };
    },
    async bulkCandidates() {
      return ["https://x/1", "https://x/2", "https://x/3"];
    },
    async inspectionBudget() {
      return { remaining: 2, resetAt: "2026-08-19T00:00:00Z" };
    },
    async enqueueInspections(_p, urls) {
      state.enqueued.push(...urls);
    },
    async listSitemaps() {
      return [{ path: "https://x/sitemap.xml", errors: 0 }] as Sitemap[];
    },
    async submitSitemap() {},
    async inspectionRecords() {
      return [];
    },
    ...over,
  };
  return repo;
}

const pro = { plan: "pro", userId: 1, propertyId: 7, detail: "standard" } as const;
const owns = async () => true;

function run(repo: IndexingRepo, tool: string, input: unknown) {
  return new Router(buildRegistry({ indexing: repo }), { ownershipCheck: owns }).run(pro, tool, input);
}

describe("Indexierungs-Tools", () => {
  it("inspect_url reicht force_refresh durch", async () => {
    const res = await run(fakeIndexing(), "inspect_url", {
      url: "https://x/seite",
      force_refresh: true,
    });
    if (res.kind !== "ok") throw new Error("erwartet ok");
    expect((res.output as { verdict: string }).verdict).toBe("PARTIAL");
  });

  it("bulk_inspect_urls plant gegen das Budget und meldet Zurückgestelltes", async () => {
    const repo = fakeIndexing();
    const res = await run(repo, "bulk_inspect_urls", { select: "top_traffic" });
    if (res.kind !== "ok") throw new Error("erwartet ok");
    const out = res.output as { planned: number; deferred: number; budgetRemaining: number };
    expect(out.planned).toBe(2); // Budget 2 von 3 Kandidaten
    expect(out.deferred).toBe(1);
    expect(out.budgetRemaining).toBe(0);
    expect(repo.enqueued).toHaveLength(2);
  });

  it("submit_sitemap verlangt confirm: true", async () => {
    const good = await run(fakeIndexing(), "submit_sitemap", {
      sitemap_url: "https://x/sitemap.xml",
      confirm: true,
    });
    expect(good.kind).toBe("ok");

    const bad = await run(fakeIndexing(), "submit_sitemap", {
      sitemap_url: "https://x/sitemap.xml",
      confirm: false,
    });
    expect(bad.kind).toBe("error"); // Zod-Literal true nicht erfüllt
  });

  it("index_coverage_overview aggregiert die gespeicherten Inspektionen", async () => {
    const repo = fakeIndexing({
      async inspectionRecords() {
        return [
          { url: "https://x/a", verdict: "PASS" },
          { url: "https://x/b", verdict: "FAIL" },
          { url: "https://x/c", verdict: "PASS" },
        ];
      },
    });
    const res = await run(repo, "index_coverage_overview", { group_by: "verdict" });
    if (res.kind !== "ok") throw new Error("erwartet ok");
    const out = res.output as { inspected: number; buckets: Array<{ key: string; count: number }> };
    expect(out.inspected).toBe(3);
    expect(out.buckets[0]).toEqual({ key: "PASS", count: 2 });
  });

  it("registriert fünf Indexierungs-Tools zusätzlich zu den Meta-Tools", () => {
    expect(buildRegistry({ indexing: fakeIndexing() }).size).toBe(7);
  });
});
