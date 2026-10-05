// Short, tested step-by-step answers to "how do I ...". Ask Spot shows these with no AI call, so they cost nothing and work
// when AI is off or out of credits. Each one describes what the app does today. When a button is renamed, update the words
// here; lib/howto-library.test.ts checks every link against the real route table.
//
// Step links use {groupId} only. A step that lives on one client's page links to the Clients list, and the words tell the
// coach to open the client, because a specific client is not known from a how-to question.
export type HowToRole = "coach" | "athlete";

export interface HowToStep {
  text: string;
  href?: string;
  linkLabel?: string;
}

export interface HowTo {
  id: string;
  title: string;
  roles: HowToRole[];
  // The steps use a screen only the desktop version has.
  desktopOnly?: boolean;
  // Words people use for this. Longer phrases score higher.
  keywords: string[];
  steps: HowToStep[];
  note?: string;
}

export const HOWTOS: HowTo[] = [
  {
    id: "assign-sessions",
    title: "Give a client sessions",
    roles: ["coach"],
    keywords: [
      "assign sessions", "give sessions", "add sessions", "add credits", "give credits", "assign credits", "give a client sessions",
      "client paid in person", "paid cash", "paid in person", "add a pack", "session pack", "top up sessions", "add session credits",
    ],
    steps: [
      { text: "Open Clients and pick the client.", href: "/groups/{groupId}/clients", linkLabel: "Clients" },
      { text: "On their profile, find Assign sessions. Type how many, add a note such as “Paid in person” if you like, and press Assign sessions." },
      { text: "Their balance goes up right away, and booking and the calendar use it." },
    ],
  },
  {
    id: "set-balance",
    title: "Set or zero a client's balance",
    roles: ["coach"],
    keywords: [
      "set balance", "zero a balance", "zero balance", "set balance to 0", "reset balance", "reset sessions", "fix balance", "wrong balance",
      "balance is wrong", "correct the balance", "set sessions to", "clear balance", "remove sessions", "take sessions away", "sessions left wrong",
    ],
    steps: [
      { text: "Open Clients and pick the client.", href: "/groups/{groupId}/clients", linkLabel: "Clients" },
      { text: "On their profile, under Assign sessions, type the number they really have in the New balance box and press Set balance. Press Set to 0 to zero it." },
      { text: "The change is written to the ledger, so you can see what happened later." },
    ],
    note: "A balance can go below zero. The coach sees it as “Owed”, and the client sees neutral wording.",
  },
  {
    id: "mark-attended",
    title: "Mark a session attended",
    roles: ["coach"],
    desktopOnly: true,
    keywords: [
      "mark attended", "mark a session attended", "mark session attended", "attended", "did they show", "client showed up", "no show",
      "charge a session", "use a credit", "mark session done", "session happened", "count a session",
    ],
    steps: [
      { text: "Open the Calendar and click the day of the session.", href: "/groups/{groupId}/calendar", linkLabel: "Calendar" },
      { text: "Find the booking and press Mark attended. The session is charged once, no matter how many times it is pressed." },
      { text: "Use Don't charge for a session you want to waive, such as a holiday or a make-good." },
    ],
    note: "If you pressed it by mistake, Undo is in the same place. If you do not see Mark attended yet, it is being switched on.",
  },
  {
    id: "add-client-before-signup",
    title: "Add a client before they sign up",
    roles: ["coach"],
    keywords: [
      "add a client", "add client", "add a client before they sign up", "before they sign up", "new client", "create a client", "start a client",
      "client profile before signup", "pre signup", "set up a client", "onboard a client", "add someone", "add an athlete",
    ],
    steps: [
      { text: "Open Clients and press Add client.", href: "/groups/{groupId}/clients", linkLabel: "Clients" },
      { text: "Type their name and email. They start as a one-on-one client, which is the right choice for most people." },
      { text: "You can build or assign their program right away. They claim the profile when they sign in with their link." },
    ],
  },
  {
    id: "send-signin-link",
    title: "Send a client their sign-in link",
    roles: ["coach"],
    keywords: [
      "sign in link", "sign-in link", "signin link", "send a sign in link", "send an invite", "invite link", "claim link", "send a link",
      "client cant sign in", "client can't log in", "client login", "invite a client", "resend invite", "new link", "client cannot sign in",
    ],
    steps: [
      { text: "Open Clients and pick the client.", href: "/groups/{groupId}/clients", linkLabel: "Clients" },
      { text: "On their profile, find the Sign-in section and press Create invite link. Copy it and send it by text or email." },
      { text: "To replace a link, press Make a new link. That cancels the old one." },
    ],
  },
  {
    id: "bulk-message",
    title: "Message all your clients at once",
    roles: ["coach"],
    keywords: [
      "bulk message", "message everyone", "message all clients", "send an announcement", "announcement", "message all", "text everyone",
      "broadcast", "send to all clients", "mass message", "message a group", "announce",
    ],
    steps: [
      { text: "Open Message all clients.", href: "/groups/{groupId}/messages/announce", linkLabel: "Message all clients" },
      { text: "Choose who gets it, write the message and send." },
    ],
  },
  {
    id: "standing-macros",
    title: "Set a client's standing macro target",
    roles: ["coach"],
    keywords: [
      "standing macro", "standing macro target", "macro target", "set macros", "set a macro target", "daily macros", "calorie target",
      "set calories", "protein target", "set nutrition target", "default macros", "macros for a client", "change macros",
    ],
    steps: [
      { text: "Open Clients and pick the client.", href: "/groups/{groupId}/clients", linkLabel: "Clients" },
      { text: "On their profile, find the Nutrition section. In Standing target, enter calories, protein, carbs or fat and press Save." },
      { text: "It applies from today on. Earlier days keep the target they had. A target you set for one day still wins for that day." },
    ],
  },
  {
    id: "assign-program",
    title: "Assign a program to a client",
    roles: ["coach"],
    keywords: [
      "assign a program", "assign program", "give a client a program", "program for a client", "put a client on a program", "send a program",
      "copy a program to a client", "assign a workout plan", "give them a program", "start a client on a program",
    ],
    steps: [
      { text: "Open Programs and find the program.", href: "/groups/{groupId}/programs", linkLabel: "Programs" },
      { text: "Press the three dots on its card and choose Assign to Client, then pick the client." },
      { text: "This makes a copy just for that client, so you can change it for them without touching the original. You can also do it from the client's profile with Programming, then Assign Program." },
    ],
  },
  {
    id: "create-package",
    title: "Create a package to sell",
    roles: ["coach"],
    desktopOnly: true,
    keywords: [
      "create a package", "make a package", "add a package", "new package", "set up a package", "sell sessions", "session pack", "set my prices",
      "create pricing", "offer a membership", "monthly membership", "recurring membership", "package pricing", "sell a package",
    ],
    steps: [
      { text: "Open Packages.", href: "/groups/{groupId}/business/packages", linkLabel: "Packages" },
      { text: "Add a package: a name, how many sessions, and the price. Choose one-time or a monthly subscription." },
      { text: "Clients see it when it is published. Keep it private to offer it only to people you assign it to." },
    ],
    note: "Buying needs payments to be set up for your account first.",
  },
  {
    id: "book-weekly",
    title: "Book a client weekly",
    roles: ["coach"],
    desktopOnly: true,
    keywords: [
      "book weekly", "weekly session", "recurring session", "recurring sessions", "repeat a session", "repeat sessions", "schedule weekly",
      "every week", "same time every week", "book a client weekly", "standing appointment", "recurring booking", "weekly booking",
    ],
    steps: [
      { text: "Open Clients and pick the client.", href: "/groups/{groupId}/clients", linkLabel: "Clients" },
      { text: "On their profile, find Weekly schedule and press New weekly schedule. Choose the first day, the time and the length." },
      { text: "Choose a number of weeks (up to 52), or No end date to keep it booked 12 weeks ahead automatically." },
      { text: "Check the list of dates. Any that clash with something are marked, and you can untick any date. Then press Book." },
      { text: "Later you can Pause, End or Add weeks, and change just one session or this one and the rest." },
    ],
    note: "From the Calendar you can also click a client's open time and choose Repeat weekly.",
  },
  {
    id: "booking-page",
    title: "Set up your public booking page",
    roles: ["coach"],
    desktopOnly: true,
    keywords: [
      "booking page", "public booking page", "set up my booking page", "booking link", "online booking", "let people book", "share a booking link",
      "book with me link", "guest booking", "people book without an account", "scheduling link",
    ],
    steps: [
      { text: "Set your weekly hours first, so there are times to book.", href: "/groups/{groupId}/availability", linkLabel: "Availability" },
      { text: "Open Booking Page. Pick your address (for example /book/ron) and add a headline and introduction.", href: "/groups/{groupId}/business/booking-page", linkLabel: "Booking Page" },
      { text: "Under Sessions people can book, tick the session types to offer and set each one's length, where it happens, and an optional price to display." },
      { text: "Turn on Take bookings on this page, press Save, and share the link. Prices stay hidden unless you switch them on." },
    ],
    note: "People who book don't need an account. They get a private link to change or cancel, and show up in Clients as a new client who hasn't signed in yet.",
  },
  {
    id: "remind-reup",
    title: "Remind a client to re-up, or put them on hold",
    roles: ["coach"],
    keywords: [
      "remind a client to pay", "remind a client to re up", "remind to re up", "remind them to pay", "needs payment", "who needs to pay",
      "client ran out of sessions", "out of sessions", "client has no sessions left", "re up", "reup", "put a client on hold",
      "stop reminding a client", "comped client", "who owes me", "send a payment reminder", "payment reminder",
    ],
    steps: [
      { text: "Open Home. Clients who have run out of sessions are listed under Needs payment, the most owed first.", href: "/dashboard", linkLabel: "Home" },
      { text: "Press Remind to send them a notification. A client is never reminded more than once every 3 days." },
      { text: "Press Hold for a client who is comped, on a break, or pays another way. They leave the list and are never reminded." },
      { text: "The same buttons are on each client's card on the Clients page, where you can also filter to Needs payment." },
    ],
    note: "You can turn reminders off for everyone on the Availability page.",
  },
  {
    id: "athlete-start-workout",
    title: "Start today's workout",
    roles: ["athlete"],
    keywords: [
      "start my workout", "start workout", "todays workout", "how do i log", "log a workout", "start training", "begin workout", "do my workout", "where is my workout",
    ],
    steps: [
      { text: "Open Today's workout.", href: "/groups/{groupId}/today", linkLabel: "Today's workout" },
      { text: "Start the workout and fill in each set as you go. Sets save as you complete them." },
      { text: "When you are done, finish the workout with the button at the bottom. Your coach sees it." },
    ],
  },
  {
    id: "athlete-book-session",
    title: "Book a session with your coach",
    roles: ["athlete"],
    keywords: [
      "book a session", "book session", "book my coach", "book an appointment", "schedule a session", "make an appointment", "reserve a time", "how do i book",
    ],
    steps: [
      { text: "Open the Calendar.", href: "/groups/{groupId}/calendar", linkLabel: "Calendar" },
      { text: "Pick a day with open times, choose a time and press Book." },
      { text: "If you are out of sessions, the page shows how to get more." },
    ],
  },
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FILL = new Set(["a", "an", "the", "to", "do", "i", "my", "me", "how", "can", "you", "for", "of", "in", "on", "and", "is", "it", "up"]);

export interface HowToMatch {
  howto: HowTo;
  score: number;
}

// Scores every how-to for this role against the (already normalized) message. A phrase match is strongest; otherwise the
// share of a phrase's words found in the message counts. Returns best first and leaves out zero scores.
export function findHowTos(normalizedMessage: string, role: HowToRole, _device?: "desktop" | "phone"): HowToMatch[] {
  const msg = ` ${normalizedMessage} `;
  const msgTokens = new Set(normalizedMessage.split(" ").filter((t) => t && !FILL.has(t)));
  const out: HowToMatch[] = [];
  for (const howto of HOWTOS) {
    if (!howto.roles.includes(role)) continue;
    let best = 0;
    for (const kw of howto.keywords) {
      const k = norm(kw);
      if (!k) continue;
      if (msg.includes(` ${k} `)) {
        best = Math.max(best, 20 + k.split(" ").length * 3);
        continue;
      }
      const kt = k.split(" ").filter((t) => t && !FILL.has(t));
      if (kt.length === 0) continue;
      const hit = kt.filter((t) => msgTokens.has(t)).length;
      if (hit === kt.length && kt.length > 1) best = Math.max(best, 12 + kt.length);
      else if (hit >= 2 && hit / kt.length >= 0.6) best = Math.max(best, 8 + hit);
    }
    if (best > 0) out.push({ howto, score: best });
  }
  return out.sort((a, b) => b.score - a.score);
}
