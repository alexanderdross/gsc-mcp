import { describe, it, expect } from "vitest";
import { backoffMs, withRetry } from "../src/index.ts";

describe("backoffMs", () => {
  it("wächst exponentiell und wird gekappt", () => {
    const opts = { baseMs: 1000, capMs: 8000, jitter: 0 };
    expect(backoffMs(0, opts)).toBe(1000);
    expect(backoffMs(1, opts)).toBe(2000);
    expect(backoffMs(2, opts)).toBe(4000);
    expect(backoffMs(3, opts)).toBe(8000);
    expect(backoffMs(4, opts)).toBe(8000); // Cap
    expect(backoffMs(10, opts)).toBe(8000);
  });

  it("hält den Jitter innerhalb ±jitter·wert", () => {
    const opts = { baseMs: 1000, jitter: 0.2 };
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const v = backoffMs(0, opts, () => r);
      expect(v).toBeGreaterThanOrEqual(800);
      expect(v).toBeLessThanOrEqual(1200);
    }
  });

  it("gibt bei rng=0.5 exakt den ungestreuten Wert", () => {
    expect(backoffMs(2, { baseMs: 500, jitter: 0.5 }, () => 0.5)).toBe(2000);
  });
});

describe("withRetry", () => {
  const retryable = { retryable: true };
  const fatal = { retryable: false };

  it("wiederholt einen retryable-Fehler und liefert dann das Ergebnis", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw retryable;
        return "ok";
      },
      { sleep: async () => {}, maxAttempts: 5 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gibt nach maxAttempts auf und wirft den letzten Fehler", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw retryable;
        },
        { sleep: async () => {}, maxAttempts: 4 },
      ),
    ).rejects.toBe(retryable);
    expect(calls).toBe(4);
  });

  it("wiederholt einen nicht-retryable-Fehler gar nicht", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw fatal;
        },
        { sleep: async () => {} },
      ),
    ).rejects.toBe(fatal);
    expect(calls).toBe(1);
  });
});
