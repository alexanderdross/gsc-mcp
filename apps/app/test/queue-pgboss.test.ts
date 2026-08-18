import { describe, it, expect } from "vitest";
import {
  PgBossInspectionQueue,
  startInspectionConsumer,
  INSPECTION_QUEUE,
  type JobSender,
  type JobWorker,
  type JobBox,
  type InspectionJob,
} from "../src/index.ts";

describe("PgBossInspectionQueue", () => {
  function fakeSender(): JobSender & { sent: Array<{ name: string; data: object }> } {
    const s = {
      sent: [] as Array<{ name: string; data: object }>,
      async send(name: string, data: object) {
        s.sent.push({ name, data });
        return "job-id";
      },
    };
    return s;
  }

  it("reiht eine Charge in die Inspektions-Queue ein", async () => {
    const sender = fakeSender();
    await new PgBossInspectionQueue(sender).enqueue(7, ["https://x/a", "https://x/b"]);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.name).toBe(INSPECTION_QUEUE);
    expect(sender.sent[0]!.data).toEqual({ propertyId: 7, urls: ["https://x/a", "https://x/b"] });
  });

  it("reiht bei leerer URL-Liste nichts ein", async () => {
    const sender = fakeSender();
    await new PgBossInspectionQueue(sender).enqueue(7, []);
    expect(sender.sent).toHaveLength(0);
  });
});

describe("startInspectionConsumer", () => {
  it("verarbeitet jede Job-Charge Zeile für Zeile", async () => {
    let registered: ((jobs: JobBox<InspectionJob>[]) => Promise<void>) | undefined;
    const worker: JobWorker = {
      async work<T>(name: string, handler: (jobs: JobBox<T>[]) => Promise<void>) {
        expect(name).toBe(INSPECTION_QUEUE);
        registered = handler as unknown as (jobs: JobBox<InspectionJob>[]) => Promise<void>;
        return "worker-id";
      },
    };
    const handled: InspectionJob[] = [];
    await startInspectionConsumer(worker, async (job) => {
      handled.push(job);
    });
    expect(registered).toBeDefined();

    await registered!([
      { data: { propertyId: 1, urls: ["a"] } },
      { data: { propertyId: 2, urls: ["b", "c"] } },
    ]);
    expect(handled).toEqual([
      { propertyId: 1, urls: ["a"] },
      { propertyId: 2, urls: ["b", "c"] },
    ]);
  });
});
