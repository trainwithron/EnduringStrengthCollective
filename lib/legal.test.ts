import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { BETA_NOTICE_PARAGRAPHS, LEGAL_VERSIONS, PLACEHOLDER_SECTIONS, SUPPORT_EMAIL_TOKEN, betaNoticeParagraphs, legalTextSnapshot, supportEmail } from "@/lib/legal";

describe("beta notice", () => {
  it("has the approved paragraphs, in order", () => {
    const leads = BETA_NOTICE_PARAGRAPHS.map((p) => p.split(".")[0]);
    expect(leads).toEqual([
      "Early software",
      "Not medical advice",
      "AI is used",
      "Your data",
      "Help search",
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

  it("says plainly what can go to the AI provider, and what does not", () => {
    const ai = BETA_NOTICE_PARAGRAPHS[2];
    expect(ai).toContain("Anthropic");
    expect(ai).toContain("photos");
    expect(ai).toContain("client names");
    expect(ai).toContain("strength numbers");
    expect(ai).toContain("injury or health concern");
    expect(ai).toContain("wearable readings");
    expect(ai).toContain("food allergies or dislikes");
    expect(ai).toContain("Messages between you and your coach, email, phone number, date of birth, body weight and progress photos are not sent.");
    expect(ai).toContain("draft for the coach to review");
  });

  it("names everyone who can see a client's data, including the platform operator during the beta", () => {
    const data = BETA_NOTICE_PARAGRAPHS[3];
    expect(data).toContain("Your coach can see data in your group");
    expect(data).toContain("people who run your coach's organization can see your training data and posts");
    expect(data).toContain("platform operator");
    expect(data).toContain("training data, wearable readings and posts");
    expect(data).toContain("Your coach can mark you private from both, which hides your training and wearable data but not posts");
    expect(data).toContain("keep the service running");
  });

  it("says that unanswered help-search questions are kept, with names removed", () => {
    const help = BETA_NOTICE_PARAGRAPHS[4];
    expect(help).toContain("can't answer a question");
    expect(help).toContain("names, email addresses, links and long numbers removed");
    expect(help).toContain("not linked to your account");
  });

  it("fills in the support address in the contact paragraph", () => {
    const out = betaNoticeParagraphs("help@enduringstrengthco.com");
    expect(out[out.length - 1]).toContain("help@enduringstrengthco.com");
    expect(out.join(" ")).not.toContain(SUPPORT_EMAIL_TOKEN);
  });

  it("never shows a made-up address when none is set", () => {
    const out = betaNoticeParagraphs(null);
    expect(out[out.length - 1]).toContain("a contact address is being added");
    expect(out.join(" ")).not.toContain(SUPPORT_EMAIL_TOKEN);
    expect(out.join(" ")).not.toMatch(/@/);
  });

  it("reads the address from the environment by default", () => {
    const before = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = " help@enduringstrengthco.com ";
    try {
      expect(supportEmail()).toBe("help@enduringstrengthco.com");
      expect(betaNoticeParagraphs().at(-1)).toContain("help@enduringstrengthco.com");
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
      else process.env.NEXT_PUBLIC_SUPPORT_EMAIL = before;
    }
  });
});

describe("legalTextSnapshot", () => {
  it("is the beta notice as shown, with its version and the support address", () => {
    const snap = legalTextSnapshot("beta_notice", "help@enduringstrengthco.com")!;
    expect(snap).toContain(`(version ${LEGAL_VERSIONS.beta_notice})`);
    for (const p of betaNoticeParagraphs("help@enduringstrengthco.com")) expect(snap).toContain(p);
  });
  it("covers the terms and the privacy policy as shown", () => {
    for (const d of ["terms", "privacy"] as const) {
      const snap = legalTextSnapshot(d)!;
      expect(snap).toContain(LEGAL_VERSIONS[d]);
      for (const s of PLACEHOLDER_SECTIONS[d]) expect(snap).toContain(s.body);
    }
  });
  it("leaves the waiver to its own snapshot", () => {
    expect(legalTextSnapshot("waiver")).toBeNull();
  });
});

describe("the AI paragraph covers every route that calls the AI", () => {
  // The beta notice's AI paragraph (and the privacy page's pointer to it) must describe what is sent. When a NEW file starts calling the AI this list fails:
  // read what that route sends and update the paragraph in lib/legal.ts first, then add the file here.
  const COVERED = [
    "app/api/admin/trivia/generate/route.ts",
    "app/api/ai/generate-meal-plan/route.ts",
    "app/api/ai/generate-program/route.ts",
    "app/api/ai/parse-food-log/route.ts",
    "app/api/ai/parse-food-photo/route.ts",
    "app/api/ai/parse-recipe/route.ts",
    "app/api/ai/parse-session-nl/route.ts",
    "app/api/ai/parse-workout/route.ts",
    "app/api/ai/program-chat/route.ts",
    "app/api/biomech-tags/suggest/route.ts",
    "app/api/coach/video-checkin/summarize/route.ts",
    "app/api/collective-intelligence/chat/route.ts",
    "app/api/cron/coach-briefing/route.ts",
    "app/api/session-pattern-check/route.ts",
    "lib/spotter-cornerstone-synthesis.ts",
    "lib/spotter-overarching-synthesis.ts",
  ];
  // The helper libraries those routes build their requests from: the "not sent" promise is checked here too.
  const HELPERS = ["lib/collective-intelligence-lookups.ts", "lib/coach-briefing-gather.ts", "lib/spotter-tier1-sync.ts"];
  function walk(dir: string, out: string[]) {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next" || name === ".git") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
    }
  }
  const root = process.cwd();
  const files: string[] = [];
  for (const top of ["app", "lib"]) walk(join(root, top), files);
  const callers = files
    .filter((f) => /\bcallClaude\(/.test(readFileSync(f, "utf8")))
    .map((f) => relative(root, f).split("\\").join("/"))
    .filter((f) => f !== "lib/anthropic-client.ts")
    .sort();

  it("lists exactly the files that call the AI today", () => {
    expect(callers).toEqual([...COVERED].sort());
  });

  // What the notice promises is not sent. None of the AI-calling files reads these.
  it("keeps the promise that messages, phone, date of birth, body weight and progress photos are not sent", () => {
    const banned = /direct_messages|\bphone\b|date_of_birth|\bbirthday\b|body_weight|progress_photo/i;
    for (const f of [...COVERED, ...HELPERS]) {
      expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(banned);
    }
  });
});
