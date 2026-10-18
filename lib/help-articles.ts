// The help center (Release SP2): short answers to the questions a coach or a client actually asks, written in plain words. Each article is a few short paragraphs; a step list is written as its own paragraphs. Nothing here promises a
// feature the app does not have, and nothing states a price, a deadline or a legal term (those live in the Terms, Privacy and Refunds pages, which the articles point to rather than repeat).
export type HelpAudience = "coach" | "client";

export interface HelpArticle {
  slug: string;
  audience: HelpAudience;
  title: string;
  summary: string;
  body: string[];
}

export const HELP_AUDIENCES: { key: HelpAudience; title: string; blurb: string }[] = [
  { key: "client", title: "If you are a client", blurb: "Logging, food, sessions, your account." },
  { key: "coach", title: "If you are a coach", blurb: "Clients, programs, nutrition, billing, your account." },
];

export const HELP_ARTICLES: HelpArticle[] = [
  // ---- clients
  {
    slug: "join-with-an-invite",
    audience: "client",
    title: "Join your coach with an invite link",
    summary: "How to get into your coach's space for the first time.",
    body: [
      "Your coach sends you an invite link. Open it on your phone, choose a password, and you are in.",
      "If you already have an account with the same email, the link connects that account to your coach instead of making a second one.",
      "If the link says it has expired, ask your coach to send a new one. Invite links do not last forever.",
    ],
  },
  {
    slug: "forgot-password",
    audience: "client",
    title: "I forgot my password",
    summary: "Get back into your account.",
    body: [
      "On the sign-in screen choose the forgot password link and enter the email you signed up with.",
      "We send a message with a link to choose a new password. If nothing arrives in a few minutes, check your spam folder and make sure you typed the same email your coach used for you.",
      "Still stuck? Ask your coach to check which email your account uses. They can correct it for you.",
    ],
  },
  {
    slug: "put-the-app-on-your-phone",
    audience: "client",
    title: "Put the app on your phone's home screen",
    summary: "Open it like any other app, with one tap.",
    body: [
      "Open the site in your phone's browser and sign in.",
      "On an iPhone, tap the share button and choose Add to Home Screen. On Android, open the browser menu and choose Install app or Add to Home screen.",
      "After that it opens full screen from its own icon. Notifications are switched on from inside the app once it is installed.",
    ],
  },
  {
    slug: "log-a-workout",
    audience: "client",
    title: "Log your workout",
    summary: "Where today's workout is and how to log it.",
    body: [
      "Today's workout is on your Home screen. Open it and log each set as you go: the weight and the reps.",
      "You can change a number after you have logged it. When you finish, complete the workout so your coach sees it.",
      "If you did something different from what was programmed, log what you really did. Your coach would rather see the truth.",
    ],
  },
  {
    slug: "log-your-food",
    audience: "client",
    title: "Log what you eat",
    summary: "Food logging on the Nutrition tab.",
    body: [
      "Open the Nutrition tab. Under Today's food you can search for a food, scan a barcode, or add something you have eaten before.",
      "If your coach set a target for you, you will see how today compares to it. If you do not see a target, your coach has not set one yet. You can still log.",
      "If your coach has turned food tracking off for you, the tab says so. Ask your coach if you would like it back.",
    ],
  },
  {
    slug: "your-grocery-list",
    audience: "client",
    title: "Your grocery list",
    summary: "A shopping list built from your meal plan.",
    body: [
      "When your coach has saved a meal plan for you, the Nutrition tab shows Your grocery list: the next seven days of your plan, added up and rounded to what you buy.",
      "Use Copy to put it in a notes app, or Print to take it to the store.",
      "Foods that break your food preferences are left off. If something is missing or wrong, tell your coach.",
    ],
  },
  {
    slug: "book-and-cancel-sessions",
    audience: "client",
    title: "Book or cancel a session",
    summary: "Sessions, credits, and cancelling.",
    body: [
      "If your coach uses sessions, open the Calendar to book a time they offer. Each session uses one of your session credits.",
      "To cancel, open the session on your calendar and cancel it. If you cancel close to the start, your coach decides whether the session still counts, because they set that rule.",
      "Your balance is on your Home screen. If it is empty, your coach can add sessions or you can buy a package they have set up.",
    ],
  },
  {
    slug: "turn-notifications-on",
    audience: "client",
    title: "Turn notifications on or off",
    summary: "Choose what reaches your phone.",
    body: [
      "Notifications are in Settings. Allow them when your phone asks, and choose what you want to hear about.",
      "If you turn on private lock screen, a notification shows only that something happened, not who or what.",
      "If you never get any, check your phone's own settings for this app and browser, and make sure the app is installed to your home screen.",
    ],
  },
  {
    slug: "parent-view-link",
    audience: "client",
    title: "A parent's view for a young athlete",
    summary: "How a parent or guardian can see how a young athlete is eating.",
    body: [
      "For a client under 13, once a parent has given their consent, the coach can send the parent or guardian a private link. It needs no login.",
      "The page shows today's meals as ate it, changed, skipped or not logged, and whether protein is running low. It does not show workouts, calories or macro numbers.",
      "The link is private to that one family, and it works until the date the coach sees. The coach can stop it at any time, and make a new one if it goes to the wrong person.",
    ],
  },
  {
    slug: "download-or-delete-my-data",
    audience: "client",
    title: "Download or delete my data",
    summary: "Your information is yours.",
    body: [
      "In Settings, Download my data gives you a copy of what you have put into the app.",
      "Delete my account removes your account. Some records your coach keeps for their business, such as payment records, are kept without your name on them. The Privacy page explains what is kept and why.",
      "If you are not sure, talk to your coach first: removing you from their list does not delete your account.",
    ],
  },
  // ---- coaches
  {
    slug: "add-your-first-client",
    audience: "coach",
    title: "Add your first client",
    summary: "Invite someone and get them logging.",
    body: [
      "Open Clients and choose Add client. Enter their name and email, and send the invite.",
      "They open the link, choose a password, and appear in your list. You can copy the link and send it yourself if an email would not reach them.",
      "If the person already has an account, the invite connects it to you, with their history, instead of making a new one.",
    ],
  },
  {
    slug: "build-and-assign-a-program",
    audience: "coach",
    title: "Build and assign a program",
    summary: "From a blank page, or with the AI builder.",
    body: [
      "Open Programs and start a new one. Add days and exercises by hand, or describe the program in a sentence and let the AI builder draft it for you to edit.",
      "Nothing the AI drafts reaches a client until you have read it and switched it on. Treat every draft as a draft.",
      "To give it to someone, assign it. Assigning makes a copy for that client, so you can keep adjusting their copy without touching your original.",
    ],
  },
  {
    slug: "set-nutrition-targets",
    audience: "coach",
    title: "Set a client's nutrition targets",
    summary: "Targets, weekly suggestions, and when to switch them off.",
    body: [
      "Open Nutrition and pick the client. Work out a starting target with the calculator, then save it. Their Nutrition tab shows it from that day.",
      "A weekly check-in can suggest a change from what they have logged. You always review a suggestion and decide; nothing is applied by itself.",
    ],
  },
  {
    slug: "see-how-clients-are-eating",
    audience: "coach",
    title: "See how all your clients are eating this week",
    summary: "The This week table.",
    body: [
      "On Nutrition, choose This week. Each client has a row: the days they logged in the last seven, their average calories and protein on those days, their target, and how their weight moved.",
      "The people who need you come first: those who logged nothing, then under or over target. For anyone who is not a confirmed adult, the row only says how many days they logged.",
    ],
  },
  {
    slug: "sessions-credits-and-bookings",
    audience: "coach",
    title: "Sessions, credits and bookings",
    summary: "How a client's sessions are counted.",
    body: [
      "A session credit is one session. You can add credits to a client, or sell packages that add them when someone pays.",
      "When a client books, a credit is used. If you cancel a session, the credit goes back to them. If a client cancels late, you decide whether it counts.",
      "Set your availability so clients only see times you can really do.",
    ],
  },
  {
    slug: "packages-and-payments",
    audience: "coach",
    title: "Packages and getting paid",
    summary: "Selling sessions and memberships.",
    body: [
      "Under Business you set up packages. Payments go through Stripe, so you connect your Stripe account first.",
      "Money questions about your own plan are best sent through Support so they are on record.",
    ],
  },
  {
    slug: "message-your-clients",
    audience: "coach",
    title: "Message and encourage your clients",
    summary: "Messages, the feed and quiet-client nudges.",
    body: [
      "Messages is for one-to-one conversations. The group Feed is for posts everyone in a group can see.",
      "If a client has gone quiet, a short note usually works better than a long one. The app suggests a few you can edit before sending.",
      "Members under 18 are shown to others as a first name and last initial, with no photo.",
    ],
  },
  {
    slug: "remove-or-delete-a-client",
    audience: "coach",
    title: "Remove or delete a client",
    summary: "Take someone off your list, and what happens to their information.",
    body: [
      "On a client's profile, under Remove or delete client, choose Remove [name] from my clients. They leave your lists and counts and lose their place in the group. Their account and everything about them stay, filed under the group and linked to their email, so nothing is lost.",
      "Open Members and look under Removed clients to see who you removed. Choose Put back and they return exactly as they were, with their level, position and history. If you invite the same email again, the existing account reconnects with its history.",
      "Delete [name] permanently is the same removal with 30 days to change your mind. After 30 days the account is erased. Their logged workouts and your notes about them are erased too only if you tick Also erase their logged workouts and my notes about them. Someone who still belongs to another group keeps their account.",
      "A client with a subscription that can still bill cannot be removed until it is canceled. Their upcoming sessions with you are cancelled and the credits go back to them, and they get a notice saying so.",
    ],
  },
  {
    slug: "pause-automatic-nutrition-suggestions",
    audience: "coach",
    title: "Switch off automatic nutrition suggestions for one client",
    summary: "Stop the weekly check-in from suggesting changes for a client.",
    body: [
      "On a client's Nutrition tab, choose No automatic suggestions for that client. The weekly check-in then makes no suggestion for them, whatever their numbers say, until it is switched back on.",
      "It applies to the person in every group they are in, including another coach's. Only the group that switched it off can switch it back on, with one tap; in another group you can see that it is on and switch it off there too. The buttons you press yourself, such as working out a starting target, still work.",
      "It is separate from No macros for this client, which stops the macro numbers for them in this group. Switching that on also stops the weekly suggestions.",
    ],
  },
  {
    slug: "payment-problems",
    audience: "coach",
    title: "Payment problems",
    summary: "Failed payments, refunds and disputes from your clients.",
    body: [
      "When a client's subscription payment fails, a refund is made in Stripe, or a client disputes a charge, it is written down and you get a notice. A payment that keeps failing is announced once, not at every retry.",
      "On Business, Payment problems lists the last 90 days for your clients. The phone's lock screen only says there is something to open, never an amount or a name.",
      "Nothing changes by itself: a refund does not take sessions back, and a failed payment does not end a client's access. You decide what to do, and you can adjust a client's sessions by hand. Receipts for clients come from Stripe's own emails.",
    ],
  },
  {
    slug: "leaving-the-platform",
    audience: "coach",
    title: "Export everything and leave",
    summary: "Your clients' history is not locked in.",
    body: [
      "If you decide to stop, you can export everything you have: your clients, programs and records.",
      "Your clients' accounts belong to them, not to you and not to us.",
    ],
  },
  {
    slug: "contact-support",
    audience: "coach",
    title: "Contact support",
    summary: "Reach the people who run the app.",
    body: [
      "Open Business, then Support, and write to us there. It keeps a record on both sides, and our reply appears in the same thread. You get a notice when we reply.",
      "Tell us what you were doing, what you expected and what happened. A screenshot helps, but please leave out anything you would not want written down.",
      "We read every message. Check the status page first if the whole app seems slow or down.",
    ],
  },
];

export const HELP_BY_SLUG = new Map(HELP_ARTICLES.map((a) => [a.slug, a]));

// The words of the support promise. It says what we do, not how fast: a response time is a promise to keep, and is added here once it is decided.
export const SUPPORT_PROMISE = "We read every message and we reply as soon as we can. If something about your money or your data looks wrong, say so plainly and we treat it first.";
