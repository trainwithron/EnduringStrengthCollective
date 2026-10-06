# One vocabulary

The words the product uses, so the same thing is never called three names on three screens. The rules for what a client or visitor reads are enforced by `lib/vocabulary.test.ts` (it reads the client-facing screens and fails on a banned word); the lists live in `lib/vocabulary.ts`. When you add a client-facing folder, add it to `CLIENT_FACING_PATHS`.

| Say | Means | Not |
|---|---|---|
| **session** | A paid slot with the coach: a 1-on-1 booking or a place in a class. A balance is "3 sessions left". Booking "uses 1 session". | "credit", "session credit", "balance of credits" on any screen a client sees. (Credit is how the database and the ledger store them. A coach's AI credits are a separate thing and never shown to a client.) |
| **workout** | One training day in a program: what you log. | "session" for a training day. (The logging page is at `/sessions/…` for historical reasons; the screen says "workout".) |
| **program** | The plan a coach builds and assigns: weeks of workouts. | "plan", "block" as a name for the whole thing. |
| **Home** | Where everyone lands. A client's Home leads with Today. A coach's Home leads with Your day. | "Dashboard" on any client screen. ("Dashboard" is the coach's per-group workspace page and the coach's side only.) |
| **Today** | The card on a client's Home that knows its state: start, resume, done for today, rest day. | |
| **Your day** | The top of a coach's Home: today's sessions and classes, and what needs them. | |
| **class** | A small-group session with a limited number of spots. Clients see Classes and "Join"; a coach manages Group sessions. When full: "waiting list". | "event", "bootcamp slot", "waitlist" (one word). |
| **client** | The coach's word for the people they coach (a coach can swap it for "athlete", "member" and so on in their vocabulary settings, and every coach screen follows). To a client it is "you" and "your coach". | "athlete" in text anyone reads (it is the name of the role in the code). |
| **Needs payment / Owed 2** | Coach-only: a client at zero sessions or below. A client sees neutral wording ("No sessions on your account right now"). | Saying "owed", "overdue" or a negative number to a client. |
| **notifications** | The bell, and the full list at Notifications. One place for every role. | "alerts", "inbox" for the same list. |
| **coach** | The person who runs the business and coaches the clients. | "trainer" (the coach's own word presets in vocabulary settings may offer it, but the product never says it). Enforced for the whole app by `lib/vocabulary.test.ts`. |
| **Spotlight** | The brand, and the coach's phone hub. | |
| **Ask Spot** | The chat a coach talks to. | "Collective Intelligence" (retired). |
| **Spotter** | The quiet detectors and the panel of what they noticed (quiet clients, expiring sessions, a client who may have moved on). They suggest; the coach decides. | "Collective Intelligence" (retired), "alerts". |
| **group** | A set of clients who train together or share a feed. | "team", except for a real sports team (team-sport mode). |
| **Find a client** | The coach's search by name, in the header, Ctrl+K. | A different picker on each screen. |

## How to keep it true

- New client-facing copy goes through the same words. If a screen needs a word that is not here, add the word here first.
- Do not rename database tables or functions to match; the words above are what people read, not what the code is called.
- Coach vocabulary settings (`lib/terminology.ts`) swap "client", "session", "group" and a few more for one coach's organization on coach screens. This list is the default those start from.
