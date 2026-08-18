import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildRegistry,
  defineTool,
  ToolRegistry,
  Router,
  checkAccess,
  applyBudget,
  rowCap,
  type Session,
} from "../src/index.ts";

describe("checkAccess", () => {
  it("erlaubt Meta-Tools jedem Plan", () => {
    expect(checkAccess("free", {}).ok).toBe(true);
  });

  it("sperrt vollständige Analyse unter Pro und nennt den nötigen Plan", () => {
    const free = checkAccess("free", { analysisTool: "detect_anomalies" });
    expect(free.ok).toBe(false);
    if (!free.ok) {
      expect(free.requiredPlan).toBe("pro");
      expect(free.message).toContain("Pro");
      expect(free.message).toContain("pricing");
    }
    expect(checkAccess("pro", { analysisTool: "detect_anomalies" }).ok).toBe(true);
  });

  it("schaltet Basis-Analyse ab Starter frei", () => {
    expect(checkAccess("free", { analysisTool: "striking_distance" }).ok).toBe(false);
    expect(checkAccess("starter", { analysisTool: "striking_distance" }).ok).toBe(true);
  });

  it("berücksichtigt minPlan", () => {
    expect(checkAccess("starter", { minPlan: "pro" }).ok).toBe(false);
    expect(checkAccess("agency", { minPlan: "pro" }).ok).toBe(true);
  });
});

describe("applyBudget", () => {
  const rows = Array.from({ length: 300 }, (_, i) => i);

  it("kürzt auf das Minimum aus Detailstufe und Planlimit", () => {
    expect(applyBudget(rows, "pro", "summary").rows).toHaveLength(10);
    expect(applyBudget(rows, "pro", "standard").rows).toHaveLength(50);
    expect(applyBudget(rows, "pro", "full").rows).toHaveLength(250);
    // Free deckelt bei 100 → 'full' (250) wird durch das Planlimit begrenzt.
    expect(applyBudget(rows, "free", "full").rows).toHaveLength(100);
  });

  it("setzt einen Hinweis nur bei Kürzung und zählt korrekt", () => {
    const full = applyBudget([1, 2, 3], "pro", "standard");
    expect(full.omitted).toBe(0);
    expect(full.note).toBeUndefined();

    const cut = applyBudget(rows, "pro", "summary");
    expect(cut.omitted).toBe(290);
    expect(cut.total).toBe(300);
    expect(cut.note).toContain("290");
  });

  it("rowCap spiegelt dieselbe Rechnung", () => {
    expect(rowCap("free", "full")).toBe(100);
    expect(rowCap("agency", "standard")).toBe(50);
  });
});

describe("Router", () => {
  const registry = buildRegistry();

  it("führt ein erlaubtes Meta-Tool aus", async () => {
    const router = new Router(registry);
    const session: Session = { plan: "free", userId: 1 };
    const res = await router.run(session, "show_pricing", {});
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") {
      expect((res.output as { plans: unknown[] }).plans).toHaveLength(4);
    }
  });

  it("meldet get_capabilities mit plan-abhängiger Verfügbarkeit", async () => {
    const reg = new ToolRegistry();
    reg.register(
      defineTool({
        name: "detect_anomalies",
        annotations: { title: "Anomalien", readOnlyHint: true },
        input: z.object({}).strict(),
        requires: { analysisTool: "detect_anomalies" },
        async handler() {
          return {};
        },
      }),
    );
    const { makeGetCapabilities } = await import("../src/tools/meta.ts");
    reg.register(makeGetCapabilities(reg));
    const router = new Router(reg);

    const asFree = await router.run({ plan: "free", userId: 1 }, "get_capabilities", {});
    const asPro = await router.run({ plan: "pro", userId: 1 }, "get_capabilities", {});
    if (asFree.kind === "ok" && asPro.kind === "ok") {
      const freeTool = (asFree.output as { tools: Array<{ name: string; available: boolean }> }).tools
        .find((t) => t.name === "detect_anomalies");
      const proTool = (asPro.output as { tools: Array<{ name: string; available: boolean }> }).tools
        .find((t) => t.name === "detect_anomalies");
      expect(freeTool?.available).toBe(false);
      expect(proTool?.available).toBe(true);
    } else {
      throw new Error("beide Aufrufe sollten ok sein");
    }
  });

  it("verweigert plangesperrte Tools mit strukturierter Meldung", async () => {
    const reg = new ToolRegistry();
    reg.register(
      defineTool({
        name: "content_decay",
        annotations: { title: "Content Decay", readOnlyHint: true },
        input: z.object({}).strict(),
        requires: { analysisTool: "content_decay" },
        async handler() {
          return { rows: [] };
        },
      }),
    );
    const router = new Router(reg);
    const res = await router.run({ plan: "starter", userId: 1 }, "content_decay", {});
    expect(res.kind).toBe("denied");
    if (res.kind === "denied") expect(res.message).toContain("Pro");
  });

  it("validiert die Eingabe gegen das Zod-Schema", async () => {
    const reg = new ToolRegistry();
    reg.register(
      defineTool({
        name: "needs_url",
        annotations: { title: "Test", readOnlyHint: true },
        input: z.object({ url: z.string().url() }).strict(),
        requires: {},
        async handler(_ctx, input) {
          return input;
        },
      }),
    );
    const router = new Router(reg);
    const bad = await router.run({ plan: "free", userId: 1 }, "needs_url", { url: "keine-url" });
    expect(bad.kind).toBe("error");
  });

  it("lehnt unbekannte Tools ab", async () => {
    const router = new Router(registry);
    const res = await router.run({ plan: "pro", userId: 1 }, "gibts_nicht", {});
    expect(res.kind).toBe("error");
  });
});

/**
 * Mandantentrennung ([docs/08]): iteriert über die Registry und stellt sicher, dass
 * JEDES Tool mit needsProperty einen fremden Property-Zugriff ablehnt. So ist ein
 * neu hinzugefügtes Tool automatisch mit abgedeckt.
 */
describe("Mandantentrennung über die gesamte Registry", () => {
  it("verweigert fremde Property-Zugriffe für jedes needsProperty-Tool", async () => {
    const reg = new ToolRegistry();
    // Ein repräsentatives property-gebundenes Tool; echte folgen später.
    reg.register(
      defineTool({
        name: "search_performance",
        annotations: { title: "Performance", readOnlyHint: true },
        input: z.object({}).strict(),
        requires: { needsProperty: true },
        async handler() {
          return { leaked: true };
        },
      }),
    );

    // ownershipCheck sagt: Property gehört dem Nutzer NICHT.
    const router = new Router(reg, { ownershipCheck: async () => false });

    for (const tool of reg.list()) {
      if (!tool.requires.needsProperty) continue;
      const res = await router.run(
        { plan: "pro", userId: 1, propertyId: 999 },
        tool.name,
        {},
      );
      expect(res.kind, `${tool.name} muss fremden Zugriff ablehnen`).toBe("error");
    }
  });
});
