// The legal and beta documents shown in the app and the versions people accept. The wording here is DRAFT and clearly
// marked as such on every page that shows it: it is plain-language placeholder text so the mechanisms (showing it,
// asking for agreement, recording which version was accepted and when) are in place. Final text, reviewed by a lawyer,
// replaces the strings below and bumps the version, which asks people to accept again.

export type LegalDocument = "beta_notice" | "terms" | "privacy" | "refunds" | "waiver";

export const LEGAL_VERSIONS: Record<LegalDocument, string> = {
  beta_notice: "2026-10-08-draft-4",
  terms: "2026-10-05-placeholder-1",
  privacy: "2026-10-08-placeholder-2",
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

// The beta notice, as Ron approved it (Oct 7). Plain language, no faith or reading line. The last paragraph names the support address: it is written as
// {support email} here and filled in by betaNoticeParagraphs() so the notice never shows a made-up address.
export const SUPPORT_EMAIL_TOKEN = "{support email}";

export const BETA_NOTICE_PARAGRAPHS: string[] = [
  "Early software. Spotlight Coaching is in beta. Features can change, break or be removed, and data could be lost. Keep your own backups of anything important.",
  "Not medical advice. Programs, nutrition numbers, readiness scores, injury flags and AI suggestions are coaching tools, not diagnosis or treatment. Check with a doctor before starting or changing training, especially with any injury or health condition.",
  "AI is used. Some tools send text, and in a few cases photos, to an AI provider (Anthropic). When a coach asks Spot questions or gets a daily briefing, the request can include client names and details such as training results, readiness and wellness check-ins, wearable readings and goals. When a coach asks for a program, it can include the names and strength numbers of the coach's clients and, for a client with an injury or health concern, a note about it. When a meal is described or photographed to log it, or a meal suggestion is written, the request can include the photo, nutrition numbers and food allergies or dislikes. A workout or recipe imported from text or a photo is sent as typed or pictured. When a coach asks the AI to build or change a program, the request and the coach's own exercise names are sent to the AI. When a coach explains a change they made, the two exercise names and the coach's explanation are sent. In the optional coaching conversation, the coach's answers and the structure of their own programs are sent. If a client is under 18, the request says so; the client's date of birth is never sent. Messages between you and your coach, email, phone number, date of birth, body weight and progress photos are not sent. AI output is a draft for the coach to review.",
  "Your data. We store the info you enter: profile, date of birth, health questionnaire, weight, wellness check-ins, nutrition logs, messages and any photos you choose to share. Your coach can see data in your group. The people who run your coach's organization can see your training data, wearable readings and posts, and the scheduling and billing details your coach keeps for you. During the beta the platform operator can also read training data, wearable readings and posts across organizations to give support. Your coach can mark you private from both, which hides your training and wearable data but not posts or scheduling and billing details. People who run the platform can also reach stored data when that is needed to keep the service running. You can download or delete your account in Settings, but some records, such as workout logs, may stay with your coach.",
  "Help search. When the app's help search can't answer a question, we keep the wording of that question to improve it, with names, email addresses, links and long numbers removed as best we can. It is not linked to your account.",
  "Texts are optional. Text messages are off unless you turn them on. Reply STOP to stop and HELP for help.",
  "No minors' real data yet. Please don't enter real data for anyone under 18 until we confirm consent, privacy and safeguarding steps.",
  "Payments and legal terms are not final. Terms of Service and the Privacy Policy are being finalized and will be sent for acceptance before wider use.",
  `Contact. Report bugs, privacy questions or deletion requests to ${SUPPORT_EMAIL_TOKEN} at any time. Tell us right away if you see someone else's data.`,
];

// The paragraphs as shown on /beta: the contact paragraph gets the real support address, or says plainly that one is being added.
export function betaNoticeParagraphs(email: string | null = supportEmail()): string[] {
  return BETA_NOTICE_PARAGRAPHS.map((p) => p.replace(SUPPORT_EMAIL_TOKEN, email ?? "us (a contact address is being added)"));
}

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
      body: "Some features send text, and in a few cases photos, to an AI provider (currently Anthropic) to generate suggestions. The beta notice lists exactly what can be sent. What the AI writes is a draft your coach reviews. The final policy will list every provider we use.",
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

// The exact text a person was shown for a document at the current version, stored with their acceptance so a record can always say what was agreed to
// (the waiver builds its own snapshot elsewhere). The beta notice is the paragraphs with the support address filled in, as /beta shows them.
export function legalTextSnapshot(document: LegalDocument, email: string | null = supportEmail()): string | null {
  const version = LEGAL_VERSIONS[document];
  if (document === "beta_notice") return [`${LEGAL_TITLES.beta_notice} (version ${version})`, ...betaNoticeParagraphs(email)].join("\n\n");
  if (document === "terms" || document === "privacy") {
    const sections = PLACEHOLDER_SECTIONS[document].map((s) => `${s.heading}\n${s.body}`);
    return [`${LEGAL_TITLES[document]} (version ${version})`, ...sections].join("\n\n");
  }
  return null;
}
