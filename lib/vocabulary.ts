// One vocabulary: the words the product uses, and the words it avoids, so the same thing is never called three names on three screens.
// docs/VOCABULARY.md explains each choice; lib/vocabulary.test.ts reads the screens a client or a visitor sees and fails on a banned word,
// so the list is enforced, not just written down.

export interface VocabularyRule {
  // What the screen should say.
  use: string;
  // Words and phrases (as regular expressions, matched case-insensitively against visible text) that must not appear on these screens.
  avoid: RegExp[];
  why: string;
}

export const CLIENT_FACING_RULES: VocabularyRule[] = [
  {
    use: "sessions (\"3 sessions left\", \"Uses 1 session\")",
    avoid: [/^credits?$/i, /\bsession credits?\b/i, /\bcredits? (left|remaining|available|balance)\b/i, /\byour credits?\b/i, /\b\d+ credits?\b/i],
    why: "A client buys and books sessions. \"Credit\" is how the database stores them, and the coach's AI credits are a different thing a client never sees.",
  },
  {
    use: "your coach",
    avoid: [/\bCoach Dashboard\b/, /\bDashboard\b/],
    why: "\"Dashboard\" is the coach's own workspace; a client has Home.",
  },
];

// Folders and files a client or a signed-out visitor sees. Add a folder here when a new client-facing area is built.
export const CLIENT_FACING_PATHS: string[] = [
  "components/athlete",
  "components/public",
  "components/leaderboard",
  "components/notifications",
  "app/book",
  "app/groups/[groupId]/classes",
  "app/groups/[groupId]/calendar",
  "app/groups/[groupId]/today",
  "app/groups/[groupId]/billing",
  "app/groups/[groupId]/more",
  "app/api/cron/expire-session-credits",
  "app/api/cron/low-balance-check",
  "app/groups/[groupId]/workouts",
  "app/sessions",
  "app/share",
  "lib/session-credit-copy.ts",
  "lib/low-balance-messages.ts",
  "lib/group-session-notify.ts",
];

// Visible text that is allowed to break a rule, with the reason. Matched against the exact text.
export const VOCABULARY_EXCEPTIONS: { text: string; reason: string }[] = [
  { text: "no session credits", reason: "compares against the database function's own error message; never shown" },
];

// Retired or off-vocabulary words anywhere a person can read them (Ron, Oct 6): the coach is a "coach", never a "trainer"; "Collective Intelligence" is
// retired (the findings are the Spotter, the chat is Ask Spot). Applies to the visible text of the whole app, not only client-facing folders.
export const PRODUCT_WIDE_RULES: VocabularyRule[] = [
  {
    use: "coach (not trainer)",
    avoid: [/\btrainers?\b/i],
    why: "The product says \"coach\". (A coach can swap words in their own vocabulary settings; the presets live in lib/terminology.ts.)",
  },
  {
    use: "Spotter or Ask Spot (not Collective Intelligence)",
    avoid: [/Collective Intelligence/i],
    why: "\"Collective Intelligence\" is retired: the detectors are the Spotter and the chat is Ask Spot.",
  },
];

// Whole files exempt from the product-wide rules, with the reason.
export const PRODUCT_WIDE_EXEMPT_FILES: { file: string; reason: string }[] = [
  { file: "lib/vocabulary.ts", reason: "this list names the words it forbids" },
  { file: "lib/terminology.ts", reason: "the word presets a coach can pick, one of which is \"trainer\"" },
  { file: "lib/nav-intents.ts", reason: "phrases a coach might type into search, matched, never shown" },
];
