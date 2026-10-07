import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "./security-headers.mjs";

const SUPABASE = "https://abcd1234.supabase.co";
type Header = { key: string; value: string };
const get = (h: Header[], key: string) => h.find((x) => x.key === key)?.value ?? "";

describe("security headers", () => {
  const prod: Header[] = buildSecurityHeaders({ isProd: true, supabaseUrl: SUPABASE });
  const dev: Header[] = buildSecurityHeaders({ isProd: false, supabaseUrl: SUPABASE });

  it("sets the five headers people expect", () => {
    for (const k of ["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]) {
      expect(get(prod, k)).not.toBe("");
    }
    expect(get(prod, "X-Frame-Options")).toBe("DENY");
    expect(get(prod, "X-Content-Type-Options")).toBe("nosniff");
    expect(get(prod, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("nobody can frame the site, and plugins and base tricks are off", () => {
    const csp = get(prod, "Content-Security-Policy");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("scripts only from this site; eval only in development", () => {
    const script = (h: Header[]) => get(h, "Content-Security-Policy").split("; ").find((d) => d.startsWith("script-src")) ?? "";
    expect(script(prod)).not.toContain("unsafe-eval");
    expect(script(dev)).toContain("unsafe-eval");
    expect(script(prod)).not.toMatch(/https?:\/\//);
  });

  it("lets the browser talk to Supabase (data and realtime) and Daily, and nothing else", () => {
    const connect = get(prod, "Content-Security-Policy").split("; ").find((d) => d.startsWith("connect-src")) ?? "";
    expect(connect).toContain(SUPABASE);
    expect(connect).toContain("wss://abcd1234.supabase.co");
    expect(connect).toContain("https://*.daily.co");
    expect(connect).toContain("wss://*.daily.co");
    expect(connect).not.toContain("stripe");
    expect(connect).not.toContain("ws:/");
  });

  it("development also allows the hot-reload websocket", () => {
    const connect = get(dev, "Content-Security-Policy").split("; ").find((d) => d.startsWith("connect-src")) ?? "";
    expect(connect).toContain("ws:");
  });

  it("allows only YouTube and Daily frames", () => {
    const frames = get(prod, "Content-Security-Policy").split("; ").find((d) => d.startsWith("frame-src")) ?? "";
    expect(frames).toContain("youtube.com");
    expect(frames).toContain("daily.co");
    expect(frames).not.toContain("'self'");
  });

  it("the coach's own pages may be framed by this site only (the workspace), nothing else changes", () => {
    const emb: Header[] = buildSecurityHeaders({ isProd: true, supabaseUrl: SUPABASE, embeddable: true });
    const csp = get(emb, "Content-Security-Policy");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("frame-ancestors 'none'");
    expect(get(emb, "X-Frame-Options")).toBe("SAMEORIGIN");
    expect(csp.split("; ").find((d) => d.startsWith("frame-src"))).toContain("'self'");
    // every other directive is exactly what the rest of the site has
    const strip = (c: string) => c.split("; ").filter((d) => !d.startsWith("frame-ancestors") && !d.startsWith("frame-src")).join("; ");
    expect(strip(csp)).toBe(strip(get(prod, "Content-Security-Policy")));
    // an ordinary page still cannot be framed by anyone
    expect(get(prod, "X-Frame-Options")).toBe("DENY");
    expect(get(prod, "Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("Google Fonts still load", () => {
    const csp = get(prod, "Content-Security-Policy");
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
  });

  it("does not block the camera or microphone, so video calls and recording keep working", () => {
    const policy = get(prod, "Permissions-Policy");
    expect(policy).not.toContain("camera");
    expect(policy).not.toContain("microphone");
    expect(policy).toContain("geolocation=()");
  });

  it("only upgrades to https and sets HSTS in production", () => {
    expect(get(prod, "Content-Security-Policy")).toContain("upgrade-insecure-requests");
    expect(get(prod, "Strict-Transport-Security")).toContain("max-age=");
    expect(get(dev, "Content-Security-Policy")).not.toContain("upgrade-insecure-requests");
    expect(get(dev, "Strict-Transport-Security")).toBe("");
  });

  it("falls back to any Supabase project when the URL is missing", () => {
    const h: Header[] = buildSecurityHeaders({ isProd: true, supabaseUrl: undefined });
    expect(get(h, "Content-Security-Policy")).toContain("https://*.supabase.co");
  });
});
