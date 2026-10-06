# Ask Spot: finding people, changing settings, reading and sending messages

Status (Oct 6): first slice built locally, not pushed. This page says what exists, what the first slice does, the guardrails every later action must keep, and what is deliberately not built yet.

## 1. What exists today

| Piece | What it does | AI cost |
|---|---|---|
| `AskSpotChatPanel` (desktop edge tab, phone Spotlight hub) | One chat. Every message goes to the free layer first. | none for the free layer |
| `POST /api/assistant/navigate` | Runs `resolveNavigation` (`lib/nav-intents.ts`) over the app's route table and `howto-library` (16 how-tos). Logs only what it could not answer, names removed (`nav_query_log`). | none |
| `POST /api/collective-intelligence/chat` | Real questions about a person's data. Two model calls (router, synthesis), read-only whitelisted lookups, `coach_chat_*` tables. Messages and client notes are never sent to the model on these paths. | credits |
| `direct_messages` | Coach and client messages. Insert policy only lets the coach and an athlete of the same group write; no delete policy. | none |
| `/api/broadcast/send` | Bulk message to a group, idempotent through `broadcast_batches`, max 500, training members only. | none |
| `coach_availability_exceptions` | Time off (written from the browser under the coach's own sign-in). | none |
| `audit_log` | Append-only; `audit_record` is callable only by triggers, so Ask Spot cannot write to it from the app. | none |

## 2. The permission tiers

1. **Navigate** (free, built). Open a screen. Never changes anything.
2. **Read** (free, first slice). Show data the coach can already see: the last few messages with a client, shown as written. No AI summary.
3. **Reversible settings** (first slice, built). A small named set, each with a before/after card, a confirm, a record, and an Undo.
4. **High impact** (not built). Anything that moves money, deletes, messages clients, or cannot be put back. Needs an explicit second confirm with the exact recipients or amounts spelled out.
5. **Never by chat.** Refunds, charges, prices, deleting a client or group, changing who owns an organization, changing anyone's password or login, anything about a minor's consent. Ask Spot says "I can't do that one from here" and points to the screen.

Anything that is not clearly one typed action gets "I can't do that yet" and the list of what it can do. It never guesses.

## 3. The first slice (built)

### 3.1 Finding the right client (`lib/client-name-match.ts`)
Pure and deterministic, over the coach's own roster only (the navigate route fetches the roster under the coach's own session, so RLS decides who is on it).
- Handles typos (one slip, two in a long name), swapped letters, possessives ("Johann's"), accents, a first name alone, a last name alone, a nickname family (Mike/Michael, Liz/Elizabeth, John/Johan/Johann and about 40 more), and a typed full name.
- Scores: exact 1.0, full name typed 1.0, both names (even with a slip) .98, nickname .96, one slip .93, first name only x.92, last name only x.88.
- **Confident** only at .80 or more with a gap of .07 over the next person. Otherwise the top 2 or 3 are offered, never a silent pick. A person in two groups counts once.
- Words that name a place or an action ("program", "show", "chat") are never read as names.

### 3.2 Open the right screen, with a question first (`lib/nav-intents.ts`)
"Pull up Johann's program" resolves to that client's current program (their own copy if they have one, else the group's), shown as a card: **"Johann Gorsik's program: is this what you're looking for? [Yes] [Not that one]"**. Yes, or Enter in the empty box, opens it. Places per client: profile, program, calendar, nutrition, messages, history, goals, balance, in-person log. Two people who fit: both are offered as buttons.

### 3.3 Settings by chat (`lib/assistant-actions.ts`, `lib/assistant-actions-server.ts`, `/api/assistant/action`)
First set: the word for the people a coach coaches (per organization), the gap between sessions, the cancellation window, minimum notice, session length, and how clients book. Each is read only at booking or cancel time, so setting it back reverses it, with one exception: **the buffer** is read by the nightly series top-up, which leaves a week that would clash with a bigger gap empty for good (the coach is told). A bigger buffer therefore shows a caution on the card.

**Not by chat: session expiry.** The nightly job applies the *current* window to credits clients already hold, zeroes them and tells each client, so a misheard number would wipe balances and Undo could not give them back. Ask Spot answers any expiry command with where to do it in Settings. (Assistant review, Oct 6.)

Three steps, and nothing is written before the second:
1. **Propose** (`/api/assistant/navigate`, coaches only). `matchAction` turns a plain command into one typed action ("set my buffer to 10 minutes"). Questions ("how do I change my buffer?") are never commands. The server reads the current value with the coach's own session and returns a before/after card and a **signed token** (HMAC, 10 minutes) that carries the coach, the action, its numbers and the before value.
2. **Confirm** (`POST /api/assistant/action`, `op: confirm`, **a click or tap on the button, never Enter**). Needs that token, for that coach, unexpired, and **refuses unless the setting still has the value the card showed** (so an old or replayed card can never overwrite a later edit). It re-checks the limits (the same limits as the settings screens: buffer 0 to 240, cancellation and notice 0 to 720, expiry 0 to 3650, session 5 to 480), re-reads the setting, then makes the **same write the settings screen makes**, under the coach's own sign-in, so the database's own rules still decide who may change it (the word for clients needs an organization owner or admin; the server reports it plainly when the database refuses). Session length refuses when any window of hours is shorter than the new length.
3. **Undo** (`op: undo`). A separate signed token (1 hour). It only runs while the setting **still has the value the change set**, so it never overwrites a later edit by hand. A session length goes back **window by window** (each window's previous length rides in the signed token), including windows that were "the same as the slot".

**Word change names the organization.** The card reads "Change the word 'clients' to 'athletes' in Enduring Strength Co.?" and applies only to that organization, fixed in the token. With no group in the page path and more than one organization owned or administered, Ask Spot asks the coach to open a page inside the one they mean. There is no "first organization" fallback.

**Enter** only answers a "is this what you're looking for?" question (opening a screen is harmless), and not while an input method is composing. A settings card needs the button. Switching booking to "Clients book themselves" shows a plain caution on the card.

No free-form SQL, no new back door, no service-role client anywhere in this path. Rate limited (180 an hour for the free layer, 60 an hour for actions). The token secret is `ASSISTANT_ACTION_SECRET` when set (Ron: add one in Vercel), else `SHARE_LINK_SECRET`, else the service key.

**The record**: each change and each undo writes a row in `spotter_recommendation_feedback` (`spotter_kind = 'assistant_action'`) with the before and after. That table is the coach's own, readable and writable only by them, so this is **a record for the coach, not a tamper-proof audit**. A real audit trail waits for the audit log (section 6).

### 3.4 What did Johann say? (read, no AI)
"What did Johann say in that last chat?" resolves to the messages screen and also shows the last five messages between the coach and that client, as written, as plain text, with a button to the full chat. Read under the coach's own session (a participant-only policy). No summary, no model.

## 4. Guardrails every later action must keep

- **Prompt injection.** A client's message, a note, a program title: all of it is **data**. It is displayed, never interpreted as a command. `matchAction` only ever reads the coach's own typed words from the chat box, and an action needs a token minted by the server for that coach moments earlier. Nothing in a stored message can produce a token.
- **No confirm bypass.** The write route does not accept an action, only a token. The token fixes the action and numbers; the browser cannot change them (signature) and cannot reuse an undo as a confirm or the reverse (`kind` field).
- **Roster scoping.** Names are resolved over the coach's own roster only. A client of another coach cannot be named, found or messaged.
- **Role checks are the database's.** Every write goes through the coach's own session so RLS decides. The chat layer adds limits and confirmation; it never grants anything.
- **Never several clients at once without a visible list.** Any bulk step (section 5) shows the exact recipients before the second confirm.
- **Ron's rule.** Nothing depends on a coach "fixing their windows first". Ask Spot validates and warns; it never sets a buffer for anyone.

## 5. Designed, not built

### 5.1 Send a message by chat (dictation to a clean draft)
1. The coach dictates: "tell Johann I moved Thursday's session to 5".
2. One client resolved confidently (3.1), otherwise the coach picks.
3. The draft is cleaned into the coach's voice **from the coach's own words only** (no invented facts), shown as a card: **[Send] [Edit] [Cancel]**. Enter means Send **only when exactly one confident client** is named.
4. Send goes through the existing validated path (`direct_messages` insert plus push). Undo where possible (a message not yet read can be taken back once a delete path exists, which today it does not, so v1 says "sent" without Undo).
5. Never several clients without a visible list and a second confirm. A client's reply is data and never triggers anything.

### 5.2 Messaging synopsis (deterministic)
Counts, who is waiting for a reply, ages, and the first line of each, no AI. An AI summary is a separate, clearly labelled opt-in, and only after the beta notice names it.

### 5.3 "I'm away" guided flow
Dates, then time off (`coach_availability_exceptions`), then the affected sessions (move, cancel, or leave), then a drafted message from templates, then the **exact recipient list** (active clients only, set-aside clients excluded), then a second confirm, then the existing broadcast path. Every step uses an existing validated write.

## 6. Audit and undo, options
- **Now**: the coach's own feedback rows (built).
- **Next**: send each confirmed change through `audit_log`. `audit_record` is callable only by triggers, so this needs a small trigger on `coach_booking_policies` and the organization terminology column, not an app write.
- **Later**: a dedicated `assistant_actions` table with the token's action, before, after and undone-at, readable by the coach and by a platform admin.

## 7. Not in the first slice
Session expiry (stays in Settings), hiding demos, sending messages, the "I'm away" flow, bulk actions, any money, any delete. Beta notice lines (a demo plays from YouTube when tapped; shared workout card links never expire) wait until Ron has read the draft.

## 8. Files
`lib/client-name-match.ts` (+test), `lib/nav-intents.ts` (+test), `lib/signed-token.ts`, `lib/assistant-actions.ts` (+test), `lib/assistant-actions-server.ts` (+test), `app/api/assistant/navigate/route.ts`, `app/api/assistant/action/route.ts`, `components/coach/ask-spot-chat-panel.tsx`.
