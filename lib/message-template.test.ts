import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BODY_MAX, DEFAULT_CLAIM_TEMPLATE, SUBJECT_MAX, renderTemplate, validateTemplate } from "@/lib/message-template";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the default sign-in email", () => {
  const m = renderTemplate(DEFAULT_CLAIM_TEMPLATE, { firstName: "Max", coachName: "Ron Arnold", link: "https://spotlightcoaching.app/claim/abc" });
  it("is the approved wording: from the coach's name, with the link, the 48 hour note and an ignore line", () => {
    expect(m.subject).toBe("Ron Arnold invited you to Spotlight Coaching");
    expect(m.text).toContain("Hi Max,");
    expect(m.text).toContain("Ron Arnold set up your training in Spotlight Coaching.");
    expect(m.text).toContain("https://spotlightcoaching.app/claim/abc");
    expect(m.text).toContain("expires in 48 hours");
    expect(m.text).toContain("If you weren't expecting this, you can ignore this email.");
  });
  it("still reads well with no names", () => {
    const n = renderTemplate(DEFAULT_CLAIM_TEMPLATE, { firstName: "", coachName: null, link: "https://x/claim/t" });
    expect(n.subject).toBe("Your coach invited you to Spotlight Coaching");
    expect(n.text.startsWith("Hi there,")).toBe(true);
  });
  it("the default itself passes the same check a coach's own wording must pass", () => {
    expect(validateTemplate(DEFAULT_CLAIM_TEMPLATE).ok).toBe(true);
  });
});

describe("a coach's own wording", () => {
  it("fills the three placeholders everywhere they appear and leaves any other {text} alone", () => {
    const out = renderTemplate({ subject: "{first_name}, {coach_name} here", body: "{coach_name} says hi {first_name} {first_name}. {link} {other}" }, { firstName: "Ann", coachName: "Bo", link: "L" });
    expect(out.subject).toBe("Ann, Bo here");
    expect(out.text).toBe("Bo says hi Ann Ann. L {other}");
  });
  it("a custom message can never be saved without the link", () => {
    const r = validateTemplate({ subject: "Hello", body: "Sign in here please" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("{link}");
  });
  it("needs a subject and a message, and keeps them within the length limits", () => {
    expect(validateTemplate({ subject: "  ", body: "{link}" }).ok).toBe(false);
    expect(validateTemplate({ subject: "Hi", body: "  " }).ok).toBe(false);
    expect(validateTemplate({ subject: "x".repeat(SUBJECT_MAX + 1), body: "{link}" }).ok).toBe(false);
    expect(validateTemplate({ subject: "Hi", body: "{link}" + "x".repeat(BODY_MAX) }).ok).toBe(false);
    expect(validateTemplate({ subject: 5, body: "{link}" }).ok).toBe(false);
  });
  it("is plain text: a subject is one line and control characters are dropped", () => {
    const r = validateTemplate({ subject: "Line one\nLine two\u0007", body: "Hi\u0000 there\n{link}" });
    expect(r.ok && r.template.subject).toBe("Line one Line two");
    expect(r.ok && r.template.body).toBe("Hi there\n{link}");
  });
  it("a placeholder in the client's own name cannot inject anything: names are put in as plain text", () => {
    const out = renderTemplate(DEFAULT_CLAIM_TEMPLATE, { firstName: "<b>Max</b>", coachName: "Ron", link: "L" });
    expect(out.text).toContain("Hi <b>Max</b>,");
  });
});

describe("where it is wired", () => {
  it("the route uses the coach's saved message when it is valid, else the default, and shows the whole address", () => {
    const route = read("app/api/clients/email-claim-link/route.ts");
    expect(route).toContain('from("coach_message_templates")');
    expect(route).toContain("validateTemplate(");
    expect(route).toContain("DEFAULT_CLAIM_TEMPLATE");
    expect(route).toContain("sentTo: email");
    expect(route).not.toContain("maskEmail");
  });
  it("the message API is the coach's own row only and validates before saving", () => {
    const api = read("app/api/coach/message-template/route.ts");
    expect(api).toContain('.eq("coach_id", user.id)');
    expect(api).toContain("validateTemplate({ subject: body.subject, body: body.body })");
    expect(api).toContain("export async function DELETE");
  });
  it("the sign-in panel offers Edit this message with the chips, a back-to-default button, and keeps Copy and Text", () => {
    const panel = read("components/coach/client-signin-panel.tsx");
    expect(panel).toContain("<EmailMessageEditor />");
    expect(panel).toContain("Text it from my phone");
    const ed = read("components/coach/email-message-editor.tsx");
    expect(ed).toContain("Edit this message");
    expect(ed).toContain("Back to the default");
    expect(ed).toContain("PLACEHOLDERS.map");
    expect(ed).toContain('!body.includes("{link}")');
    expect(ed).toContain("min-h-11");
  });
  it("the table is private to the coach, and the body must contain {link} in the database too", () => {
    const sql = read("supabase/migrations/0327_coach_message_templates.sql");
    expect(sql).toContain("position('{link}' in claim_email_body) > 0");
    expect(sql).toContain("coach_id = (select auth.uid())");
    expect(sql).toContain("enable row level security");
  });
});
