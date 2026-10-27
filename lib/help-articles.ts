// The help center: short answers to the questions a coach or a client actually asks, written in plain words. Eleven articles (Oct 27: the 21 short ones were folded into these, every sentence
// checked against the live app; docs/help-rewrite-draft-oct27.md), each in headed sections. Nothing here promises a feature the app does not have, and nothing states a price, a deadline or a
// legal term (those live in the Terms, Privacy and Refunds pages, which the articles point to rather than repeat). Button names are written exactly as they appear on screen.
export type HelpAudience = "coach" | "client";

export interface HelpBullet {
  lead?: string; // shown in bold before the text
  text: string;
}

export interface HelpSection {
  heading: string;
  body: string[];
  bullets?: HelpBullet[];
  after?: string[]; // paragraphs that follow the bullets
}

export interface HelpArticle {
  slug: string;
  audience: HelpAudience;
  title: string;
  summary: string;
  sections: HelpSection[];
}

export const HELP_AUDIENCES: { key: HelpAudience; title: string; blurb: string }[] = [
  { key: "client", title: "If you are a client", blurb: "Logging, food, sessions, your account." },
  { key: "coach", title: "If you are a coach", blurb: "Clients, programs, nutrition, billing, your account." },
];

export const HELP_ARTICLES: HelpArticle[] = [
  // ---- clients
  {
    slug: "getting-started",
    audience: "client",
    title: "Getting started",
    summary: "Your first sign-in, a forgotten password, and the app on your phone.",
    sections: [
      {
        heading: "Your first sign-in",
        body: [
          "Your coach sends you a sign-in link. Open it, choose a password, and tap Set password & continue. If your coach invited you to a group, the link says Create account & join (or Sign in & join if you already have an account).",
        ],
      },
      {
        heading: "Before your first workout",
        body: [
          "You fill in a short form once: your date of birth, a health screening and a waiver. If you are under 18, a parent or guardian has to agree. You type their email and tap Send the request, and they get an email to sign. You can't sign it yourself.",
        ],
      },
      {
        heading: "Forgot your password",
        body: [
          "On the sign-in screen, tap Forgot password?, enter your email and tap Send reset link. If nothing arrives in a few minutes, check your spam folder and make sure it's the email your coach has for you. Your coach can fix it if it's wrong.",
        ],
      },
      {
        heading: "Put the app on your phone",
        body: [
          "On an iPhone, open the site in Safari, tap Share, then Add to Home Screen. On Android, choose Install app or Add to Home Screen from the browser menu. On an iPhone, finish setting your password first, then add the app and sign in again from the new icon.",
        ],
      },
      { heading: "If a link has expired", body: ["Ask your coach for a new one."] },
    ],
  },
  {
    slug: "log-your-workout",
    audience: "client",
    title: "Log your workout",
    summary: "Finding today's workout, logging sets, and finishing.",
    sections: [
      { heading: "Find it", body: ["Today's workout is on Home. Tap Start workout."] },
      {
        heading: "Log your sets",
        body: [
          "Type the weight and reps for each set. A set counts as done when it has both (reps only for bodyweight moves, and any one box for timed holds or distance). Done sets turn green. RPE and the other boxes are optional. If you did something different from the plan, log what you really did.",
        ],
      },
      { heading: "Watch a demo", body: ["Tap the video picture or Demo on any exercise. You can hide demos in Settings > Workout Logging."] },
      {
        heading: "Finish",
        body: ["Tap Complete workout so your coach sees it. You can also Pause for now and come back later. If you leave a workout open, Home reminds you to finish it."],
      },
    ],
  },
  {
    slug: "food",
    audience: "client",
    title: "Food",
    summary: "Logging what you eat, your targets, and your grocery list.",
    sections: [
      {
        heading: "Log food",
        body: ["Open Nutrition. Under Today's food you can Search foods, Scan a barcode, Take a photo, enter Just the numbers, pick from Favorites or Recent, or Copy yesterday."],
      },
      {
        heading: "Your targets",
        body: [
          "If your coach set targets, you see how today compares. If they haven't yet, the Set my targets card works one out for you to use until they do. Find my real maintenance helps you find the true number over time from what you log and how your weight moves.",
        ],
      },
      {
        heading: "Your grocery list",
        body: ["When your coach saves a meal plan for you, Your grocery list adds up the next seven days. Use Copy or Print. Foods that break your food preferences are left off."],
      },
      { heading: "Tracking turned off", body: ["If your coach turned food tracking off for you, the tab says so. Ask them if you want it back."] },
    ],
  },
  {
    slug: "sessions",
    audience: "client",
    title: "Sessions",
    summary: "Booking, cancelling, and your balance.",
    sections: [
      { heading: "Your balance", body: ["The top of Calendar shows how many sessions you have available. Home shows it too."] },
      { heading: "Book", body: ["On Calendar, tap Schedule, pick a time and tap Book. It uses 1 session. To book the same time every week, use Book weekly."] },
      {
        heading: "Cancel",
        body: [
          "Open the session and tap Cancel session. If you cancel before your coach's cancellation window, the session goes back to your balance. Inside the window, your coach is told and decides whether it counts.",
        ],
      },
      { heading: "Buy more", body: ["If your coach sells packages, buy them in Settings > Billing."] },
    ],
  },
  {
    slug: "your-account",
    audience: "client",
    title: "Your account",
    summary: "Notifications, your data, and deleting your account.",
    sections: [
      {
        heading: "Notifications",
        body: [
          "In Settings > Notifications, turn on notifications and allow them when your phone asks. Quiet hours keeps your phone silent overnight. Private lock screen shows only \"You have a new notification\", with no names or details. If nothing ever arrives, check your phone's settings for this app and make sure it's added to your home screen.",
        ],
      },
      {
        heading: "Download your data",
        body: [
          "Download my data in Settings gives you a file with your logs, plans, messages, bookings and settings. A very large one comes as a short private link that stops working after a few minutes.",
        ],
      },
      {
        heading: "Delete your account",
        body: [
          "Delete my account removes your account. Your logged workouts stay in your coach's records, no longer tied to your name. Payment records are kept without your name. The Privacy page explains why. If your coach removes you from their list, that doesn't delete your account.",
        ],
      },
    ],
  },

  // ---- coaches
  {
    slug: "your-phone",
    audience: "coach",
    title: "Your phone",
    summary: "The Spotlight button, notices, and today's cards.",
    sections: [
      {
        heading: "What it opens to",
        body: ["Your phone opens to your own training (Home, Calendar, Feed, Nutrition, Settings). If you coach a team, it opens to the team's Home."],
      },
      {
        heading: "The Spotlight button",
        body: [
          "The button at the top is where your coaching lives: Clients, Messages, Business (with Quick payment), Program and Ask Spot. A number on it means you have new notices. They're at the top when you open it, with Mark all read.",
        ],
      },
      {
        heading: "Today's cards",
        body: ["Under the notices you'll see:"],
        bullets: [
          { lead: "Did [name]'s session happen?", text: "Answer Yes, No-show (then Charge 1 session or Waive), Reschedule, or add a note only you can see." },
          { lead: "Start [name]'s workout", text: "(or Resume) for your next client." },
          { text: "Late changes, requests and clients who have gone quiet." },
        ],
        after: ["The same cards are on your phone Calendar and on the computer's Home."],
      },
      { heading: "Everything else", body: ["Bigger jobs (building programs, packages, settings) are easier on a computer."] },
    ],
  },
  {
    slug: "clients",
    audience: "coach",
    title: "Clients",
    summary: "Adding, messaging, removing and putting back.",
    sections: [
      {
        heading: "Add a client",
        body: [
          "Tap Add client and choose one-on-one or a group. Enter their name (email is optional). Nothing is sent yet, so you can build their program and schedule first. When you're ready, open their profile and tap Email the sign-in link, or Create sign-in link and send it yourself. If they already have an account, they get an invitation and join only if they accept.",
        ],
      },
      {
        heading: "Get them started",
        body: ["A new client's profile shows a short checklist: assign a program, add sessions, put them on the calendar, send their sign-in link."],
      },
      {
        heading: "Add many at once",
        body: ["Choose Add to a group, then Paste a list (one name per line, with an email after a comma) or pick a .csv or .xlsx file. Undo this import takes it all back."],
      },
      {
        heading: "Messages and the feed",
        body: [
          "Messages is one-to-one. The Team feed is for posts the whole group sees. For a client who has gone quiet, the app suggests a short note you can edit before sending. Anyone who isn't a confirmed adult (including anyone with no date of birth on file) is shown to others as a first name and last initial, with no photo.",
        ],
      },
      {
        heading: "Remove, put back, delete",
        body: ["On the profile, go to Billing & settings > Remove or delete client."],
        bullets: [
          { lead: "Remove [name] from my clients:", text: "takes them off your lists. Everything about them is kept." },
          {
            lead: "Put back:",
            text: "they're under Removed clients at the bottom of Members. Put back returns them exactly as they were. Inviting the same email again also reconnects them with their history.",
          },
          {
            lead: "Delete [name] permanently:",
            text: "gives you 30 days to change your mind, then erases the account. Their logged workouts and your notes are erased only if you tick Also erase their logged workouts and my notes about them. Someone who still belongs to another group keeps their account.",
          },
          {
            text: "A client with a subscription that can still bill can't be removed until it's canceled. Their upcoming sessions are cancelled, the sessions go back to them, and they get a notice.",
          },
        ],
      },
    ],
  },
  {
    slug: "programs",
    audience: "coach",
    title: "Programs",
    summary: "Building, importing, assigning, templates and demo videos.",
    sections: [
      {
        heading: "Build one",
        body: [
          "On Programs, tap + New program and add days and exercises. Or type what you want in the AI Program Builder and edit the draft. It saves as you go, and nothing reaches a client until you assign it.",
        ],
      },
      {
        heading: "Import one",
        body: [
          "Import program takes a spreadsheet (.csv, .xlsx), a PDF, text or a photo. Before anything is made you check each exercise. An exact name from your library always matches itself. \"(you matched this before)\" means a match you picked on an earlier import. Use your [name] uses the exercise you already have, so no duplicate is made. Add as its own new exercise adds it.",
        ],
      },
      {
        heading: "Change later weeks",
        body: [
          "In the builder box, type the change, for example \"drop the squats to 8 reps from week 2 on\". You see exactly what will change, and nothing is saved until you tap Apply. Days a client has already started are never changed.",
        ],
      },
      {
        heading: "Your organization's programs",
        body: [
          "Programs you make from Programs belong to your organization, and the top of the builder says [organization] > Programs. A program made from a group's own Programs page belongs to that group.",
        ],
      },
      {
        heading: "Assign",
        body: [
          "Tap Assign and pick clients, groups, or both. A client gets their own copy, so you can change it for them without touching the original. A group gets one copy that everyone in it follows, together with the group's feed.",
        ],
      },
      {
        heading: "Templates",
        body: [],
        bullets: [
          {
            lead: "Make a template:",
            text: "in a program's menu. It makes a new template and leaves the original alone. Exercises that are on your movement ladders become slots. The rest stay as they are, and a line tells you which. If you don't have ladders yet, the starter ladders are added for you.",
          },
          {
            lead: "+ Slot:",
            text: "a slot is \"a movement, not a set exercise\": a movement pattern, the side (either, bilateral or unilateral), the class (A, B or C), and sets x reps.",
          },
          {
            lead: "Use this template:",
            text: "choose a level (Beginner, Intermediate or Advanced), optionally a client and anything to work around, then Pick for me to fill each slot. Make the program (or Make and assign) creates a normal program, and the template stays as it was.",
          },
          { text: "Templates have their own tab on Programs." },
        ],
      },
      {
        heading: "Demo videos",
        body: [
          "An exercise can show a demo. If you haven't added your own, the Spotlight demo shows (\"Spotlight demo. Add your own to replace it.\"). Adding your own video or YouTube link replaces it for you and your clients only.",
        ],
      },
    ],
  },
  {
    slug: "logging-and-sessions",
    audience: "coach",
    title: "Logging and sessions",
    summary: "Logging for a client, credits, the calendar, and no-shows.",
    sections: [
      {
        heading: "Log a client's workout",
        body: ["Tap Start [name]'s workout on the Spotlight button, Log their workout on their profile, or Log on the computer's Clients page."],
      },
      {
        heading: "Wing it",
        body: ["No program for today? Tap Wing it and type or say each exercise as they do it, for example \"squat 3x5 225, bench 3x8 155\"."],
      },
      {
        heading: "Sessions come off by themselves",
        body: [
          "If you log during a client's booked time, that booking counts as attended and uses 1 session. Before you start, it says which session it is. If there was no booking, finishing asks \"Put this on your calendar? Uses 1 session.\" (not asked in team-sport groups).",
        ],
      },
      {
        heading: "Credits",
        body: ["A session is one credit. Add sessions on a client's profile, or sell packages (Clients > Packages on the computer)."],
      },
      {
        heading: "On the calendar",
        body: ["A booking can be marked Mark attended (1 session used) or Mark no-show (Charge 1 session or Waive). Both have Undo."],
      },
      {
        heading: "Late cancels and late changes",
        body: [
          "Set your cancellation window in Calendar > Availability. When a client cancels or moves inside it, nothing is taken by itself. You get a card to Charge (1 session) or Waive.",
        ],
      },
      {
        heading: "Availability",
        body: [
          "In Calendar > Availability, choose how clients book (Clients book on their own, Clients request, I confirm, or I schedule everyone), your limits, and your rules. Your public page with a free consultation is there too. To book a client at the same time every week, use their profile's weekly schedule.",
        ],
      },
    ],
  },
  {
    slug: "nutrition",
    audience: "coach",
    title: "Nutrition",
    summary: "Targets, weekly suggestions, and the This week table.",
    sections: [
      {
        heading: "Set a target",
        body: ["Go to Nutrition > Clients, pick the client, then Targets > Set the standing target. The calculator is inside. Their Nutrition tab shows it from that day."],
      },
      {
        heading: "Weekly check-in",
        body: ["It can suggest a change from what they logged. You always decide: Apply or Dismiss. Nothing changes by itself. Run a check-in now runs one on demand."],
      },
      {
        heading: "Switches (under Targets > Details)",
        body: [],
        bullets: [
          {
            lead: "No automatic suggestions for [name]:",
            text: "the check-in suggests nothing for them until you switch it back. It applies in every group they're in, and only the group that switched it off can switch it back on. Buttons you press yourself still work.",
          },
          { lead: "No macros for [name]:", text: "hides the macro numbers for them in this group and also stops suggestions." },
          { lead: "Food tracking:", text: "turns their logging off or on." },
        ],
      },
      {
        heading: "This week",
        body: [
          "One row per client for the last seven days: days logged, average calories and protein, target, and weight change. Clients who need you come first. For anyone who isn't a confirmed adult, or who has suggestions off, it shows only the days logged.",
        ],
      },
    ],
  },
  {
    slug: "business",
    audience: "coach",
    title: "Business",
    summary: "Packages, payments, support, and leaving.",
    sections: [
      {
        heading: "Packages and getting paid",
        body: [
          "Set up packages under Clients > Packages. Until payments are turned on, packages are added to clients by hand. Card payments go through Stripe. Connect it in Settings > Organization > View Revenue Splits.",
        ],
      },
      {
        heading: "Payment problems",
        body: [
          "A failed payment, a refund or a disputed charge is written down and you get a notice, once. Business lists the last 90 days. Nothing changes by itself: a refund doesn't take sessions back, and a failed payment doesn't end access. You decide, and you can adjust sessions by hand. Receipts come from Stripe's own emails.",
        ],
      },
      {
        heading: "Support",
        body: [
          "Write to us in Settings > Support. The reply comes back in the same thread, and you get a notice. Tell us what you did, what you expected and what happened. Leave out anything you wouldn't want written down.",
        ],
      },
      {
        heading: "Export everything and leave",
        body: [
          "Settings > Organization > Export my business gives you a zip of spreadsheets: clients, programs, workouts, every logged set, bookings, credits and notes. Your clients' accounts belong to them.",
        ],
      },
    ],
  },
];

export const HELP_BY_SLUG = new Map(HELP_ARTICLES.map((a) => [a.slug, a]));

// The 21 addresses the help center had before Oct 27, each sent (permanently) to the article that now holds its content, so an old link or bookmark still lands on the answer.
export const OLD_HELP_SLUGS: Record<string, string> = {
  "join-with-an-invite": "getting-started",
  "forgot-password": "getting-started",
  "put-the-app-on-your-phone": "getting-started",
  "log-a-workout": "log-your-workout",
  "log-your-food": "food",
  "your-grocery-list": "food",
  "book-and-cancel-sessions": "sessions",
  "turn-notifications-on": "your-account",
  "download-or-delete-my-data": "your-account",
  "add-your-first-client": "clients",
  "message-your-clients": "clients",
  "remove-or-delete-a-client": "clients",
  "build-and-assign-a-program": "programs",
  "sessions-credits-and-bookings": "logging-and-sessions",
  "set-nutrition-targets": "nutrition",
  "see-how-clients-are-eating": "nutrition",
  "pause-automatic-nutrition-suggestions": "nutrition",
  "packages-and-payments": "business",
  "payment-problems": "business",
  "leaving-the-platform": "business",
  "contact-support": "business",
};

// The words of the support promise. It says what we do, not how fast: a response time is a promise to keep, and is added here once it is decided.
export const SUPPORT_PROMISE = "We read every message and we reply as soon as we can. If something about your money or your data looks wrong, say so plainly and we treat it first.";
