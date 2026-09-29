export interface QuickTip {
  hook: string;
  detail: string;
}

export const COACH_QUICK_TIPS: QuickTip[] = [
  {
    hook: "Fill in your bio and photo on Home — it shows up the moment a client taps your name.",
    detail:
      "One coach, one client, zero copy required: go to Home, click your name card, add a real photo and a couple of sentences. The next time that client opens Messages and taps your name, they see it — a small trust signal that costs you 60 seconds once.",
  },
  {
    hook: "Backfill a client's PR history before you program for them.",
    detail:
      "On any client's profile, \"Backfill training history\" lets you (or them) log a recent max or a few past sessions — flagged honestly as self-reported, never faked as a real logged workout — so the AI Program Builder has a real number to ground a new program in instead of guessing.",
  },
  {
    hook: "When the Programming Spotter flags something, use Deny — it actually learns.",
    detail:
      "Denying a flag you disagree with isn't just dismissing noise for today; it's teaching the system your own pattern for that specific kind of suggestion. Confirm/Deny/Edit are all real signals, not just a close button.",
  },
  {
    hook: "Try the card-stack layout for a few days if your dashboard feels crowded.",
    detail:
      "The icon in your sidebar footer (hover for \"Switch to floating card-stack layout\") turns your Clients/Business/Calendar/Program panels into overlapping windows you drag and resize instead of one long scroll — genuinely a different way of working, easy to miss because it's just an icon.",
  },
  {
    hook: "A denied Spotter suggestion isn't gone forever the first time — that's on purpose.",
    detail:
      "If the same flag reappears after you dismiss it once, it's not a bug: real signals need two dismissals before they go quiet for good, so one accidental tap can't silence something that turns out to matter.",
  },
  {
    hook: "Your social links live in two places for a reason — fill in both halves.",
    detail:
      "Bio/photo is on Home; social links and per-day link pinning are under Resources → Pro Shop. Both feed the same popup a client sees when they tap your name — worth doing both in one sitting rather than assuming one covers it.",
  },
  {
    hook: "If you run a multi-trainer org, your dispatch settings have their own tab now.",
    detail:
      "The response-window timer and your public intake link live under Organization → Trainer Dispatch, not folded into the Team tab — bookmark it once so you're not hunting for it later.",
  },
  {
    hook: "A workout your client can't finish isn't a dead end anymore.",
    detail:
      "If a client has to bail mid-session, \"Exit workout\" saves everything they already logged and marks the session honestly instead of leaving it stuck \"in progress\" forever — you'll see it as a real, complete (if short) session, not a mystery gap in their history.",
  },
];

export const ATHLETE_QUICK_TIPS: QuickTip[] = [
  {
    hook: "Can't finish a workout? Tap \"Exit workout,\" don't just close the app.",
    detail:
      "Everything you've already logged is saved either way — this just tells your coach honestly that you stopped rather than leaving a session stuck open forever.",
  },
  {
    hook: "The wellness check-in takes 10 seconds and actually changes what your coach sees.",
    detail:
      "Sleep/soreness/energy feed directly into your coach's daily picture of how you're doing — skipping it isn't wrong, but answering it means fewer \"how are you feeling?\" texts later.",
  },
  {
    hook: "Tap your coach's name in Messages to see their real profile.",
    detail:
      "Bio, photo, and any social links they've added all live one tap away from their name — worth checking once, especially if you're curious about their background or want to follow them elsewhere.",
  },
  {
    hook: "Logging body weight regularly is what makes your trend line mean something.",
    detail:
      "One data point can't show a trend — a couple of times a week, logged consistently, is what turns \"Log today's weight\" into a real picture over time instead of a single number.",
  },
  {
    hook: "Nutrition logging has three ways in — use whichever is fastest in the moment.",
    detail:
      "Manual entry, a barcode scan, or a photo all land in the same place — don't feel locked into typing everything out if you're standing in a grocery aisle with a barcode in hand.",
  },
  {
    hook: "If your coach hasn't set nutrition targets yet, that's not a glitch.",
    detail:
      "The Nutrition tab is honest about \"no targets set for today yet\" rather than making something up — it'll populate the moment your coach configures a real plan for you.",
  },
];
