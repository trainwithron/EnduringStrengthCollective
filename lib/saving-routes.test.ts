import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SAVING_API } from "./workspace-mutation";

const root = join(__dirname, "..");

function routeFiles(rel: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const child = join(rel, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(child));
    else if (entry.name === "route.ts") out.push(child);
  }
  return out;
}

// Routes that can be called with POST/PUT/PATCH/DELETE but do NOT save coach or client data that another pane would show: they ask an AI, search, sign in, take a
// payment, send a push or text, or are called by another service. Every other writing route must be in SAVING_API (lib/workspace-mutation.ts), so that a save made
// through it refreshes the other panes. A new route fails this test until it is put in one of the two places on purpose.
const NOT_A_SAVE = new Set([
  // an invited coach choosing their password on the join page, before they have a session: no pane is open to show anything
  "/api/coaches/join",
  // a guardian's consent: emailed links and a server-only record; nothing a pane shows changes
  "/api/guardian-consent/request",
  "/api/guardian-consent/resend",
  "/api/guardian-consent/void",
  "/api/guardian-consent/sign",
  "/api/guardian-consent/withdraw",
  // asks which members must be shown as a first name and last initial; reads only
  "/api/groups/[groupId]/name-protection",
  // emails graduating players their own training history after a new season is started; it changes nothing a pane shows
  "/api/season/graduate",
  "/api/email-change/confirm",
  "/api/email-change/cancel",
  "/api/email-change/cancel-mine",
  "/api/coach/start-own-account",
  "/api/coach/message-template",
  "/api/admin/trivia/generate",
  "/api/ai/generate-meal-plan",
  "/api/ai/generate-program",
  "/api/ai/parse-food-log",
  "/api/ai/parse-food-photo",
  "/api/ai/parse-inbody-scan",
  "/api/ai/learn-reason",
  "/api/ai/parse-recipe",
  "/api/ai/parse-session-nl",
  "/api/ai/parse-workout",
  "/api/ai/program-chat",
  "/api/ai/explain-program",
  "/api/assistant/navigate",
  "/api/org/announce", // a message to the team's notifications, not data a pane shows
  "/api/coach/needs-attention", // a read that takes its group ids in a body (a long list does not fit in an address)
  "/api/auth/forgot-password",
  "/api/auth/resend-confirmation",
  "/api/ai/suggest-patterns",
  "/api/programs/sweep-empty-days",
  "/api/groups/discard-empty",
  "/api/intake/minor-consent-notice",
  "/api/ai/pick-template",
  "/api/biomech-tags/suggest",
  "/api/coach/act-as",
  "/api/coaches/signup",
  "/api/collective-intelligence/chat",
  "/api/feedback",
  "/api/food/barcode",
  "/api/garmin/webhook",
  "/api/org-dispatch/submit",
  "/api/public-booking/[slug]/book",
  "/api/public-booking/[slug]/verify-email/confirm",
  "/api/public-booking/[slug]/verify-email/send",
  "/api/public-booking/manage/[token]",
  "/api/public/discovery-book",
  "/api/public/gym-lead",
  "/api/push/send",
  "/api/push/subscribe",
  "/api/push/unsubscribe",
  "/api/session-pattern-check",
  "/api/share/sign",
  "/api/stripe/checkout",
  "/api/stripe/coach-checkout",
  "/api/stripe/connect/onboard",
  "/api/stripe/portal",
  "/api/stripe/quick-payment-checkout",
  "/api/stripe/webhook",
  "/api/twilio/inbound",
  "/api/series/preview",
]);

describe("every route that can save is either counted as a save or listed as not one", () => {
  const writing = routeFiles("app/api")
    .filter((f) => /export (async )?function (POST|PUT|PATCH|DELETE)\b|export const (POST|PUT|PATCH|DELETE)\b/.test(readFileSync(join(root, f), "utf8")))
    .map((f) => "/" + f.replace(/\\/g, "/").replace(/^app\//, "").replace(/\/route\.ts$/, ""));

  it("finds the routes", () => {
    expect(writing.length).toBeGreaterThan(50);
    expect(statSync(join(root, "app/api")).isDirectory()).toBe(true);
  });

  it("no writing route is in neither place", () => {
    const missing = writing.filter((p) => !SAVING_API.test(p.replace(/\[([^\]]+)\]/g, "$1")) && !NOT_A_SAVE.has(p));
    expect(missing, "Add each to SAVING_API (lib/workspace-mutation.ts) if it saves data a pane could show, or to NOT_A_SAVE here if it does not").toEqual([]);
  });

  it("nothing is listed as not-a-save while also counting as a save, and every listed route exists", () => {
    for (const p of NOT_A_SAVE) {
      if (p === "/api/series/preview") continue; // the preview is an exception inside a saving area
      expect(SAVING_API.test(p.replace(/\[([^\]]+)\]/g, "$1")), p).toBe(false);
      expect(writing.includes(p), `${p} no longer exists as a writing route`).toBe(true);
    }
  });

  it("the preview of a series is not a save, though series itself is", () => {
    expect(SAVING_API.test("/api/series/occurrence")).toBe(true);
    expect(SAVING_API.test("/api/series/preview")).toBe(false);
  });
});
