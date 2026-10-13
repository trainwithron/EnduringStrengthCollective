import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("asking for a review, once and quietly", () => {
  it("appears only for an adult client after 12 sessions and is recorded so it never returns", () => {
    const section = read("components/athlete/review-prompt-section.tsx");
    expect(section).toContain("REVIEW_PROMPT_SESSIONS = 12");
    expect(section).toContain("if (shown || (count ?? 0) < REVIEW_PROMPT_SESSIONS) return null;");
    expect(section).toContain("if (await athleteIsMinor(supabase, athleteId)) return null;");
    expect(section).not.toContain("review_url");
    expect(read("app/(coach)/groups/[groupId]/page.tsx")).toContain("isToday && !isCoach && !isActingAsOther && athleteId && <ReviewPromptSection");
    const card = read("components/athlete/review-prompt-card.tsx");
    expect(card).toContain('record("not_now")');
    expect(card).toContain('record("quote")');
  });
  it("is a text box and a consent tick, with no Google link anywhere", () => {
    const card = read("components/athlete/review-prompt-card.tsx");
    expect(card).toContain("Enjoying training with {coachName}? Leave a review.");
    expect(card).toContain("I agree {coachName} may share this publicly, for example on their website.");
    expect(card).toContain("share_publicly: agree");
    expect(card).not.toMatch(/google/i);
    expect(read("components/coach/desktop/website-settings.tsx")).not.toMatch(/Your Google review link|review_url/i);
    expect(read("supabase/migrations/0356_review_prompt_and_client_quotes.sql")).not.toContain("review_url");
  });
  it("a review without the tick stays private to the coach; a ticked one goes on the page only when the coach adds it", () => {
    const sql = read("supabase/migrations/0356_review_prompt_and_client_quotes.sql");
    expect(sql).toContain("share_publicly boolean not null default false");
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("revoke update on public.client_quotes from authenticated;");
    expect(sql).toContain("grant update (status) on public.client_quotes to authenticated;");
    const settings = read("components/coach/desktop/website-settings.tsx");
    expect(settings).toContain("if (!q.sharePublicly) return;");
    expect(settings).toContain("Private: the client did not agree to share it.");
    expect(settings).toContain("Nothing shows on your page until you add it.");
  });
});

describe("the quote carries the client's first name", () => {
  it("the section reads it and the card saves it with the quote, so a quote the coach adds to the page is attributed", () => {
    const section = readFileSync(join(__dirname, "..", "components/athlete/review-prompt-section.tsx"), "utf8");
    const card = readFileSync(join(__dirname, "..", "components/athlete/review-prompt-card.tsx"), "utf8");
    expect(section).toContain("firstName={firstName}");
    expect(card).toContain("first_name: firstName.slice(0, 30) || null");
  });
});
