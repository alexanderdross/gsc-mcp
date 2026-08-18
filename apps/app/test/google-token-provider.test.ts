import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  GoogleOAuth,
  GoogleTokenProvider,
  encryptSecret,
  type GoogleTokenRefresher,
  type CredentialSource,
} from "../src/index.ts";
import type { FetchFn } from "@gsc/gsc-client";

describe("GoogleOAuth.refreshAccessToken", () => {
  it("tauscht den Refresh-Token gegen einen Access-Token", async () => {
    let seenBody = "";
    const fetchFn: FetchFn = async (_url, init) => {
      seenBody = init.body ?? "";
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "ya29.neu", expires_in: 3599 }),
        text: async () => "",
      };
    };
    const g = new GoogleOAuth({ clientId: "cid", clientSecret: "sec", redirectUri: "https://x/cb", fetchFn });
    const res = await g.refreshAccessToken("1//refresh");
    expect(res.accessToken).toBe("ya29.neu");
    expect(res.expiresInSec).toBe(3599);
    expect(seenBody).toContain("grant_type=refresh_token");
    expect(seenBody).toContain("refresh_token=1%2F%2Frefresh");
  });
});

describe("GoogleTokenProvider", () => {
  const key = randomBytes(32);

  function deps(clock: { t: number }) {
    let calls = 0;
    const refresher: GoogleTokenRefresher = {
      async refreshAccessToken() {
        calls++;
        return { accessToken: `at-${calls}`, expiresInSec: 3600 };
      },
    };
    const credentials: CredentialSource = {
      async getRefreshToken() {
        return encryptSecret("1//refresh", key);
      },
    };
    const provider = new GoogleTokenProvider({ refresher, credentials, encryptionKey: key, now: () => clock.t });
    return { provider, refreshCount: () => calls };
  }

  it("holt einen Token und cached ihn bis kurz vor Ablauf", async () => {
    const clock = { t: 1_000_000 };
    const { provider, refreshCount } = deps(clock);
    expect(await provider.forUser(1)).toBe("at-1");
    expect(await provider.forUser(1)).toBe("at-1"); // aus dem Cache
    expect(refreshCount()).toBe(1);
  });

  it("erneuert nach Ablauf (inkl. Vorlaufzeit)", async () => {
    const clock = { t: 1_000_000 };
    const { provider, refreshCount } = deps(clock);
    await provider.forUser(1);
    clock.t += 3_600_000; // eine Stunde weiter → abgelaufen
    expect(await provider.forUser(1)).toBe("at-2");
    expect(refreshCount()).toBe(2);
  });

  it("invalidate erzwingt eine Erneuerung", async () => {
    const clock = { t: 1_000_000 };
    const { provider, refreshCount } = deps(clock);
    await provider.forUser(1);
    provider.invalidate(1);
    await provider.forUser(1);
    expect(refreshCount()).toBe(2);
  });

  it("wirft ohne verknüpfte Google-Credentials", async () => {
    const provider = new GoogleTokenProvider({
      refresher: { async refreshAccessToken() { return { accessToken: "x", expiresInSec: 1 }; } },
      credentials: { async getRefreshToken() { return null; } },
      encryptionKey: key,
    });
    await expect(provider.forUser(99)).rejects.toThrow();
  });
});
