import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { isSealedToken, openToken, openTokenRow, sealToken, sealedTokenColumns, tokenCryptoEnabled, tokenHash } from "@/lib/token-crypto";

const KEY_HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const KEY_B64 = Buffer.from(KEY_HEX, "hex").toString("base64");
const OTHER_KEY = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";
const original = process.env.WEARABLE_TOKEN_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.WEARABLE_TOKEN_KEY;
  else process.env.WEARABLE_TOKEN_KEY = original;
});

describe("scrambling wearable and calendar tokens", () => {
  it("does nothing until a key is set: tokens are stored and read exactly as before", () => {
    delete process.env.WEARABLE_TOKEN_KEY;
    expect(tokenCryptoEnabled()).toBe(false);
    expect(sealToken("abc")).toBe("abc");
    expect(openToken("abc")).toBe("abc");
  });

  it("scrambles with a key (hex or base64), reads it back, and never stores the plain token", () => {
    for (const key of [KEY_HEX, KEY_B64]) {
      process.env.WEARABLE_TOKEN_KEY = key;
      const sealed = sealToken("super-secret-token");
      expect(sealed.startsWith("enc:v1:")).toBe(true);
      expect(sealed).not.toContain("super-secret-token");
      expect(isSealedToken(sealed)).toBe(true);
      expect(openToken(sealed)).toBe("super-secret-token");
    }
  });

  it("a token stored plain before the key was set is still read, and sealing twice does not double-scramble", () => {
    process.env.WEARABLE_TOKEN_KEY = KEY_HEX;
    expect(openToken("old-plain-token")).toBe("old-plain-token");
    const once = sealToken("t");
    expect(sealToken(once)).toBe(once);
  });

  it("the same token scrambles differently each time", () => {
    process.env.WEARABLE_TOKEN_KEY = KEY_HEX;
    expect(sealToken("t")).not.toBe(sealToken("t"));
  });

  it("refuses a wrong key, a missing key, damage and a bad key, with a plain message that never says refresh", () => {
    process.env.WEARABLE_TOKEN_KEY = KEY_HEX;
    const sealed = sealToken("t");
    process.env.WEARABLE_TOKEN_KEY = OTHER_KEY;
    expect(() => openToken(sealed)).toThrow(/could not be read/);
    delete process.env.WEARABLE_TOKEN_KEY;
    expect(() => openToken(sealed)).toThrow(/key is not set/);
    process.env.WEARABLE_TOKEN_KEY = KEY_HEX;
    const damaged = sealed.slice(0, -4) + (sealed.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => openToken(damaged)).toThrow(/could not be read|damaged/);
    expect(() => openToken("enc:v1:AAAA")).toThrow(/damaged/);
    process.env.WEARABLE_TOKEN_KEY = "too-short";
    expect(() => sealToken("t")).toThrow(/32 bytes/);
    for (const message of ["key is not set", "could not be read", "damaged", "32 bytes"]) expect(message).not.toMatch(/refresh/i);
  });

  it("the fingerprint is stable, one-way and does not depend on the key", () => {
    delete process.env.WEARABLE_TOKEN_KEY;
    const a = tokenHash("garmin-token");
    process.env.WEARABLE_TOKEN_KEY = KEY_HEX;
    expect(tokenHash("garmin-token")).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("garmin");
    expect(tokenHash("other")).not.toBe(a);
  });

  it("writes the columns the table needs, with the fingerprint only where asked", () => {
    process.env.WEARABLE_TOKEN_KEY = KEY_HEX;
    const plain = sealedTokenColumns({ accessToken: "a", refreshToken: "r" });
    expect(Object.keys(plain)).toEqual(["access_token", "refresh_token"]);
    const withHash = sealedTokenColumns({ accessToken: "a", refreshToken: "r" }, { withHash: true });
    expect(withHash.access_token_hash).toBe(tokenHash("a"));
    expect(openTokenRow(withHash as { access_token: string; refresh_token: string })).toEqual({ accessToken: "a", refreshToken: "r" });
  });
});

describe("every place that writes or reads a connection's tokens goes through the scrambler", () => {
  const writers = ["app/api/garmin/callback/route.ts", "app/api/google-calendar/callback/route.ts", "app/api/google-health/callback/route.ts", "app/api/oura/callback/route.ts", "app/api/withings/callback/route.ts"];
  const refreshers = ["app/api/cron/google-calendar-sync/route.ts", "app/api/google-health/sync/route.ts", "app/api/oura/sync/route.ts", "app/api/withings/sync/route.ts", "lib/google-calendar-mirror-server.ts"];

  it("nothing writes a raw access or refresh token", () => {
    for (const f of [...writers, ...refreshers]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/access_token: (tokens|refreshed)\.accessToken/);
      expect(src, f).not.toMatch(/refresh_token: (tokens|refreshed)\.refreshToken/);
      expect(src, f).toContain("sealedTokenColumns(");
    }
  });

  it("nothing reads a stored token without unscrambling it", () => {
    for (const f of refreshers) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/=\s*tokenRow\.access_token/);
      expect(src, f).toContain("openToken(tokenRow.access_token)");
      expect(src, f).toContain("openToken(tokenRow.refresh_token)");
    }
  });

  it("Garmin saves the fingerprint and the push is matched by it (and by the plain token for a connection saved before)", () => {
    expect(readFileSync("app/api/garmin/callback/route.ts", "utf8")).toContain("{ withHash: true }");
    const webhook = readFileSync("app/api/garmin/webhook/route.ts", "utf8");
    expect(webhook).toContain('.in("access_token_hash"');
    expect(webhook).toContain('.in("access_token", uniqueTokens)');
  });

  it("the daily job fills in each fingerprint in the same update that scrambles the token, only if the row is unchanged", () => {
    const job = readFileSync("app/api/cron/protect-wearable-tokens/route.ts", "utf8");
    expect(job).toContain("{ withHash: true }");
    expect(job).toContain('.eq("access_token", row.access_token)');
    expect(job).toContain("CRON_SECRET");
    expect(readFileSync("vercel.json", "utf8")).toContain("/api/cron/protect-wearable-tokens");
  });
});
