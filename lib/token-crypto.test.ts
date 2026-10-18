import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isSealedToken, openToken, openTokenRow, sealToken, sealedTokenColumns, tokenCryptoEnabled, tokenHash, tokenOwner } from "@/lib/token-crypto";

const KEY_HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const KEY_B64 = Buffer.from(KEY_HEX, "hex").toString("base64");
const OTHER_KEY = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";
const ann = tokenOwner("wearable", "oura", "ann-id");
const bo = tokenOwner("wearable", "oura", "bo-id");
const original = process.env.WEARABLE_TOKEN_KEY;
afterEach(() => {
  vi.restoreAllMocks();
  if (original === undefined) delete process.env.WEARABLE_TOKEN_KEY;
  else process.env.WEARABLE_TOKEN_KEY = original;
});

describe("scrambling wearable and calendar tokens", () => {
  it("does nothing until a key is set: tokens are stored and read exactly as before", () => {
    delete process.env.WEARABLE_TOKEN_KEY;
    expect(tokenCryptoEnabled()).toBe(false);
    expect(sealToken("abc", ann, "access")).toBe("abc");
    expect(openToken("abc", ann, "access")).toBe("abc");
  });

  it("scrambles with a key (hex or base64), reads it back, and never stores the plain token", () => {
    for (const key of [KEY_HEX, KEY_B64]) {
      process.env.WEARABLE_TOKEN_KEY = key;
      const sealed = sealToken("super-secret-token", ann, "access");
      expect(sealed.startsWith("enc:v1:")).toBe(true);
      expect(sealed).not.toContain("super-secret-token");
      expect(isSealedToken(sealed)).toBe(true);
      expect(openToken(sealed, ann, "access")).toBe("super-secret-token");
    }
  });

  it("a token stored plain before the key was set is still read, and sealing twice does not double-scramble", () => {
    process.env.WEARABLE_TOKEN_KEY = KEY_HEX;
    expect(openToken("old-plain-token", ann, "access")).toBe("old-plain-token");
    const once = sealToken("t", ann, "access");
    expect(sealToken(once, ann, "access")).toBe(once);
  });

  it("the same token scrambles differently each time", () => {
    process.env.WEARABLE_TOKEN_KEY = KEY_HEX;
    expect(sealToken("t", ann, "access")).not.toBe(sealToken("t", ann, "access"));
  });

  it("a scrambled token moved onto another person's row, another provider's, or into the other column does not open", () => {
    process.env.WEARABLE_TOKEN_KEY = KEY_HEX;
    const sealed = sealToken("ann-token", ann, "access");
    expect(() => openToken(sealed, bo, "access")).toThrow(/could not be read/);
    expect(() => openToken(sealed, tokenOwner("wearable", "withings", "ann-id"), "access")).toThrow(/could not be read/);
    expect(() => openToken(sealed, tokenOwner("calendar", "oura", "ann-id"), "access")).toThrow(/could not be read/);
    expect(() => openToken(sealed, ann, "refresh")).toThrow(/could not be read/);
    expect(openToken(sealed, ann, "access")).toBe("ann-token");
  });

  it("refuses a wrong key, a missing key, damage and a bad key, with a plain message that never says refresh", () => {
    process.env.WEARABLE_TOKEN_KEY = KEY_HEX;
    const sealed = sealToken("t", ann, "access");
    const messages: string[] = [];
    const grab = (fn: () => unknown, pattern: RegExp) => {
      try {
        fn();
        messages.push("NO THROW");
      } catch (e) {
        messages.push((e as Error).message);
        expect((e as Error).message).toMatch(pattern);
      }
    };
    process.env.WEARABLE_TOKEN_KEY = OTHER_KEY;
    grab(() => openToken(sealed, ann, "access"), /could not be read/);
    delete process.env.WEARABLE_TOKEN_KEY;
    grab(() => openToken(sealed, ann, "access"), /key is not set/);
    process.env.WEARABLE_TOKEN_KEY = KEY_HEX;
    grab(() => openToken(sealed.slice(0, -4) + (sealed.endsWith("AAAA") ? "BBBB" : "AAAA"), ann, "access"), /could not be read|damaged/);
    grab(() => openToken("enc:v1:AAAA", ann, "access"), /damaged/);
    process.env.WEARABLE_TOKEN_KEY = "too-short";
    grab(() => sealToken("t", ann, "access"), /32 bytes/);
    for (const m of messages) expect(m).not.toMatch(/refresh/i);
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
    const plain = sealedTokenColumns({ accessToken: "a", refreshToken: "r" }, ann);
    expect(Object.keys(plain)).toEqual(["access_token", "refresh_token"]);
    const withHash = sealedTokenColumns({ accessToken: "a", refreshToken: "r" }, ann, { withHash: true });
    expect(withHash.access_token_hash).toBe(tokenHash("a"));
    expect(openTokenRow(withHash as { access_token: string; refresh_token: string }, ann)).toEqual({ accessToken: "a", refreshToken: "r" });
  });

  it("never loses tokens a provider just handed over: with an unusable key they are stored as they are and the problem is logged without any token text", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.WEARABLE_TOKEN_KEY = "63-characters-is-not-a-key";
    let columns: ReturnType<typeof sealedTokenColumns> | undefined;
    expect(() => {
      columns = sealedTokenColumns({ accessToken: "new-access", refreshToken: "new-refresh" }, ann, { withHash: true });
    }).not.toThrow();
    expect(columns).toMatchObject({ access_token: "new-access", refresh_token: "new-refresh", access_token_hash: tokenHash("new-access") });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("new-access");
    expect(JSON.stringify(log.mock.calls)).not.toContain("new-refresh");
  });
});

describe("every place that writes or reads a connection's tokens goes through the scrambler", () => {
  const wearableWriters = ["app/api/garmin/callback/route.ts", "app/api/google-health/callback/route.ts", "app/api/oura/callback/route.ts", "app/api/withings/callback/route.ts"];
  const writers = [...wearableWriters, "app/api/google-calendar/callback/route.ts"];
  const wearableRefreshers = ["app/api/google-health/sync/route.ts", "app/api/oura/sync/route.ts", "app/api/withings/sync/route.ts"];
  const refreshers = [...wearableRefreshers, "app/api/cron/google-calendar-sync/route.ts", "lib/google-calendar-mirror-server.ts"];

  it("nothing writes a raw access or refresh token", () => {
    for (const f of [...writers, ...refreshers]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/access_token: (tokens|refreshed)\.accessToken/);
      expect(src, f).not.toMatch(/refresh_token: (tokens|refreshed)\.refreshToken/);
      expect(src, f).toContain("sealedTokenColumns(");
    }
  });

  it("every writer of a wearable token saves the fingerprint (Garmin pushes are found by it), including any future refresh", () => {
    for (const f of [...wearableWriters, ...wearableRefreshers]) expect(readFileSync(f, "utf8"), f).toMatch(/sealedTokenColumns\([^\n]*\{ withHash: true \}\)/);
    expect(readFileSync("app/api/garmin/callback/route.ts", "utf8")).toContain("must pass { withHash: true }");
  });

  it("every token is bound to its owner when written and when read", () => {
    for (const f of [...writers, ...refreshers]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("tokenOwner(");
      expect(src, f).not.toMatch(/openToken\(tokenRow\.\w+\)/);
    }
    for (const f of refreshers) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain('openToken(tokenRow.access_token, owner, "access")');
      expect(src, f).toContain('openToken(tokenRow.refresh_token, owner, "refresh")');
    }
  });

  it("a provider's new tokens are never discarded silently: the save is checked", () => {
    for (const f of refreshers) expect(readFileSync(f, "utf8"), f).toContain("if (saveError) throw new Error(\"Couldn't save the new connection tokens.\")");
  });

  it("Garmin saves the fingerprint and the push is matched by it, never by a scrambled stored value", () => {
    const webhook = readFileSync("app/api/garmin/webhook/route.ts", "utf8");
    expect(webhook).toContain('.in("access_token_hash"');
    expect(webhook).toContain('.in("access_token", uniqueTokens)');
    const filter = webhook.indexOf("filter((token) => !isSealedToken(token))");
    expect(filter).toBeGreaterThan(-1);
    expect(filter).toBeLessThan(webhook.indexOf('.in("access_token_hash"'));
    expect(filter).toBeLessThan(webhook.indexOf('.in("access_token", uniqueTokens)'));
  });

  it("the daily job protects rows in id order past failures, and a run with a failure or a bad key is a failed run", () => {
    const job = readFileSync("app/api/cron/protect-wearable-tokens/route.ts", "utf8");
    expect(job).toContain("{ withHash: true }");
    expect(job).toContain('.eq("access_token", row.access_token)');
    expect(job).toContain('.order("id", { ascending: true })');
    expect(job).toContain('.gt("id", lastId)');
    expect(job).toContain("status: failed > 0 ? 500 : 200");
    expect(job).toContain("CRON_SECRET");
    expect(readFileSync("vercel.json", "utf8")).toContain("/api/cron/protect-wearable-tokens");
  });
});
