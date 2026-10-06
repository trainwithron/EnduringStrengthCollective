// The legal and beta documents shown in the app and the versions people accept. The wording here is DRAFT and clearly
// marked as such on every page that shows it: it is plain-language placeholder text so the mechanisms (showing it,
// asking for agreement, recording which version was accepted and when) are in place. Final text, reviewed by a lawyer,
// replaces the strings below and bumps the version, which asks people to accept again.

export type LegalDocument = "beta_notice" | "terms" | "privacy" | "refunds" | "waiver";

export const LEGAL_VERSIONS: Record<LegalDocument, string> = {
  beta_notice: "2026-10-05-draft-3",
  terms: "2026-10-05-placeholder-1",
  privacy: "2026-10-05-placeholder-1",
  refunds: "2026-10-05-placeholder-1",
  waiver: "2026-10-05-draft-1",
};

export const LEGAL_TITLES: Record<Exclude<LegalDocument, "waiver">, string> = {
  beta_notice: "Beta notice",
  terms: "Terms of use",
  privacy: "Privacy policy",
  refunds: "Refunds and cancellations",
};

// What someone agrees to when they sign up or are brought in by a coach.
export const SIGNUP_DOCUMENTS: LegalDocument[] = ["beta_notice", "terms", "privacy"];

// The address people write to for problems and privacy questions. Set NEXT_PUBLIC_SUPPORT_EMAIL; until then the pages
// say it is being added rather than showing a made-up address.
export function supportEmail(): string | null {
  const v = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
  return v ? v : null;
}

export const DRAFT_BANNER =
  "This page is being finalized. The wording below is a draft written in plain language and has not yet been reviewed by a lawyer.";

export const BETA_NOTICE_PARAGRAPHS: string[] = [
  "This app is an early version (a beta). It is being built and tested with real people while we make it better, so things will change, and some things may not work the way you expect.",
  "Adults only for now. Please do not enter real information for anyone under 18. Anyone under 13 is blocked from using the app unless a parent or guardian's consent has been verified.",
  "Beta means data could be lost. Please do not rely on the app as your only record. Keep your own backups and notes of anything important, such as your training numbers and any payments, until we tell you the beta is over.",
  "What is stored: your name, email and, if you give them, your phone number and date of birth. Also your health questionnaire answers, your weight, wellness check-ins, training and nutrition logs, your messages, and any photos or videos you choose to share.",
  "Help search: when the app's help search cannot answer a question, we keep the wording of that question to improve it, after removing names, email addresses, links and numbers as best we can. It is not linked to your account. Questions it can answer are not kept as text.",
  "Who can see it: your coach, and the people who run your coach's organization. During the beta, the platform operator can also read training data across organizations in order to give support, unless a client has been marked private. We plan to tighten this, and we are telling you about it now rather than later.",
  "AI features: some features send text such as workout notes, nutrition entries and, for the coach's assistant features, client names to an AI provider, Anthropic, in order to produce suggestions. What the AI writes is a draft for your coach to review, not a decision. We are working to send less personal detail than that.",
  "Text messages are optional and are off unless you turn them on. Reply STOP to any text to stop them, and HELP for help.",
  "The app and what it suggests are not medical advice. Check with a qualified professional before changing your training or nutrition if you have an injury, an illness or a medical condition, and stop if something hurts.",
  "You can export your data or delete your account in Settings. When you delete your account, your personal details, check-ins, posts and messages are erased, but some records, such as workout logs and your coach's own notes and payment records, may stay with your coach, no longer linked to you.",
  "If you ever see someone else's data, please tell us right away using the report button or by writing to us. If something else breaks or seems wrong, please tell us too. Your feedback is how the app gets better.",
];

export const PLACEHOLDER_SECTIONS: Record<"terms" | "privacy" | "refunds", { heading: string; body: string }[]> = {
  terms: [
    {
      heading: "What these terms are for",
      body: "The full terms of use are being prepared. Until they are published, using the app means you also accept the beta notice, which explains that this is an early version that will change.",
    },
    {
      heading: "In the meantime",
      body: "Your coach is responsible for the coaching they give you. The app is a tool for logging training and staying in touch. It does not give medical advice.",
    },
  ],
  privacy: [
    {
      heading: "What we keep",
      body: "The full privacy policy is being prepared. In short: the app stores the details you and your coach enter (your name, email, training and nutrition logs, messages and, if you use them, wearable data) so it can work. Your coach and the people who run your coach's organization can see what is relevant to coaching you.",
    },
    {
      heading: "AI features",
      body: "Some features send text such as workout notes, nutrition entries and, for coach assistant features, client names to an AI provider (currently Anthropic) to generate suggestions. What the AI writes is a draft your coach reviews. The final policy will list every provider we use.",
    },
    {
      heading: "Your choices",
      body: "You can export your data or delete your account from your settings. Email us with any privacy question.",
    },
  ],
  refunds: [
    {
      heading: "Payments and refunds",
      body: "Coaching packages are set and sold by your coach. The refund and cancellation terms that apply to a package will be shown when you buy it. This page will be completed when payments are switched on.",
    },
  ],
};
