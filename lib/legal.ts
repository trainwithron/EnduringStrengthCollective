// The legal and beta documents shown in the app and the versions people accept. The wording here is DRAFT and clearly
// marked as such on every page that shows it: it is plain-language placeholder text so the mechanisms (showing it,
// asking for agreement, recording which version was accepted and when) are in place. Final text, reviewed by a lawyer,
// replaces the strings below and bumps the version, which asks people to accept again.

export type LegalDocument = "beta_notice" | "terms" | "privacy" | "refunds" | "waiver";

export const LEGAL_VERSIONS: Record<LegalDocument, string> = {
  beta_notice: "2026-10-05-draft-1",
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
  "Please do not rely on it as your only record. Keep your own notes of anything important, such as your training numbers and any payments, until we tell you the beta is over.",
  "Your training, health and contact details are stored so the app can work for you and your coach. Your coach can see what you log. Some features send details such as workout notes, nutrition entries and, for the coach's assistant features, client names to an AI service in order to produce suggestions. We are working to send less personal detail than that.",
  "The app and what it suggests are not medical advice. Check with a qualified professional before changing your training or nutrition if you have an injury, an illness or a medical condition, and stop if something hurts.",
  "You can ask for a copy of your data or ask us to delete your account from your settings, or by writing to us.",
  "If something breaks or seems wrong, please tell us. Your feedback is how the app gets better.",
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
      body: "Some features send text such as workout notes, nutrition entries and, for coach assistant features, client names to an AI provider to generate suggestions. The final policy will list the providers we use.",
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
