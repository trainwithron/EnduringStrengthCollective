import { describe, expect, it } from "vitest";
import { BETA_NOTICE_PARAGRAPHS, SUPPORT_EMAIL_TOKEN, betaNoticeParagraphs, supportEmail } from "@/lib/legal";

describe("beta notice", () => {
  it("has the eight approved paragraphs, in order", () => {
    const leads = BETA_NOTICE_PARAGRAPHS.map((p) => p.split(".")[0]);
    expect(leads).toEqual([
      "Early software",
      "Not medical advice",
      "AI is used",
      "Your data",
      "Texts are optional",
      "No minors' real data yet",
      "Payments and legal terms are not final",
      "Contact",
    ]);
  });

  it("carries no faith, reading or quote line anywhere (Ron: firm)", () => {
    const all = BETA_NOTICE_PARAGRAPHS.join(" ");
    expect(all).not.toMatch(/bible|scripture|king james|verse|psalm|faith|\bread during\b|\bquote/i);
  });

  it("says plainly that photos and client names can go to the AI provider", () => {
    const ai = BETA_NOTICE_PARAGRAPHS[2];
    expect(ai).toContain("Anthropic");
    expect(ai).toContain("photos");
    expect(ai).toContain("client names");
    expect(ai).toContain("draft for the coach to review");
  });

  it("fills in the support address in the contact paragraph", () => {
    const out = betaNoticeParagraphs("help@enduringstrengthco.com");
    expect(out[7]).toContain("help@enduringstrengthco.com");
    expect(out.join(" ")).not.toContain(SUPPORT_EMAIL_TOKEN);
  });

  it("never shows a made-up address when none is set", () => {
    const out = betaNoticeParagraphs(null);
    expect(out[7]).toContain("a contact address is being added");
    expect(out.join(" ")).not.toContain(SUPPORT_EMAIL_TOKEN);
    expect(out.join(" ")).not.toMatch(/@/);
  });

  it("reads the address from the environment by default", () => {
    const before = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = " help@enduringstrengthco.com ";
    try {
      expect(supportEmail()).toBe("help@enduringstrengthco.com");
      expect(betaNoticeParagraphs()[7]).toContain("help@enduringstrengthco.com");
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
      else process.env.NEXT_PUBLIC_SUPPORT_EMAIL = before;
    }
  });
});
