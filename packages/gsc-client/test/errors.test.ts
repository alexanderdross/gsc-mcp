import { describe, it, expect } from "vitest";
import { classifyGscError } from "../src/index.ts";

const withReason = (reason: string) => ({ error: { errors: [{ reason }] } });

describe("classifyGscError", () => {
  it("trennt 403 quotaExceeded von 403 forbidden anhand des reason", () => {
    expect(classifyGscError(403, withReason("quotaExceeded")).kind).toBe("quota_exceeded");
    expect(classifyGscError(403, withReason("dailyLimitExceeded")).kind).toBe("quota_exceeded");
    expect(classifyGscError(403, withReason("userRateLimitExceeded")).kind).toBe("rate_limited");
    expect(classifyGscError(403, withReason("forbidden")).kind).toBe("forbidden");
    expect(classifyGscError(403, {}).kind).toBe("forbidden");
  });

  it("bildet die übrigen Codes ab", () => {
    expect(classifyGscError(400, {}).kind).toBe("bad_request");
    expect(classifyGscError(401, {}).kind).toBe("invalid_grant");
    expect(classifyGscError(404, {}).kind).toBe("not_found");
    expect(classifyGscError(429, {}).kind).toBe("rate_limited");
    expect(classifyGscError(500, {}).kind).toBe("server");
    expect(classifyGscError(503, {}).kind).toBe("server");
    expect(classifyGscError(418, {}).kind).toBe("unknown");
  });

  it("markiert nur rate_limited und server als retryable", () => {
    expect(classifyGscError(429, {}).retryable).toBe(true);
    expect(classifyGscError(500, {}).retryable).toBe(true);
    expect(classifyGscError(401, {}).retryable).toBe(false);
    expect(classifyGscError(403, withReason("quotaExceeded")).retryable).toBe(false);
  });

  it("übernimmt die Google-Fehlermeldung", () => {
    const e = classifyGscError(400, { error: { message: "Bad dimension" } });
    expect(e.message).toBe("Bad dimension");
  });
});
