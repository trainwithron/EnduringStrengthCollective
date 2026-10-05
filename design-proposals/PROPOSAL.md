# Sentence-case labels and red for primary actions only

Nothing here is applied to the app. The "after" screenshots come from the live
pages with four CSS rules injected in the browser, so they show what the
central rule would do without editing a single component.

Files in this folder:

- `phone-athlete-home-before.jpg` / `phone-athlete-home-after.jpg` (375px, athlete Home)
- `desktop-client-profile-before.jpg` / `desktop-client-profile-after.jpg` (coach client profile, desktop width)

## What the app does today

- 945 uses of `uppercase` in components. 572 are small body-font labels
  ("Session credits", "Today", "Kcal"), 368 are display-font headings.
- Rust (the orange) is used 726 times as text, 515 times as a border colour,
  313 times as a solid button and 102 times as a tint. So it marks links, labels,
  outlines and status as well as the main action, and it stops meaning "press this".

## E. Sentence case, one central rule

**Rule:** the small body-font labels are written in sentence case. Display-font
headings (Barlow Condensed) stay uppercase, because that face is drawn for it
and it is what gives the app its look.

**How, safely:**

1. One rule in `globals.css`, behind `:root[data-label-case="sentence"]`:
   `.font-body.uppercase { text-transform: none; letter-spacing: 0 }`.
   Turning it on is one attribute on `<html>`; turning it off is removing it.
   No component is edited in this step, and the source text is already authored
   in normal case, so nothing needs retyping.
2. A sweep for text that depends on capitals: abbreviations authored in caps
   stay as written ("RPE", "PR", "RIR"); a "keep-caps" class for the few
   places where caps carry meaning (for example "NEW PR").
3. Once approved and checked, delete the `uppercase` class from those
   572 label usages in one mechanical pass, so the rule is no longer the only thing holding it.

**What the screenshots show:** the phone tab bar ("Home / Calendar / Feed"),
"Today", "Your targets today", "Kcal / Protein / Carbs / Fat" all read as plain
sentences. Headings like TRAINING DAY and TEST SANDBOX GROUP are unchanged.

**Risk:** low. Label widths shrink slightly (good for phone). The only visual
loss is the "label" feel that capitals give small text, which is the point.

## F. Rust for the main action only

**Rule:** rust (the filled orange) means "do this". Everything else uses
neutrals, with amber reserved for "needs your attention".

**Mapping:**

| Today | Becomes |
| --- | --- |
| Solid rust button (the main action) | Stays rust |
| `text-rust` links and small action text | Chalk with an underline |
| `border-rust` outlined buttons | Steel outline, chalk text |
| Rust tints (`bg-rust/10`) used as callouts | Neutral surface; amber if it is a warning |
| Selected or active state (current tab) | Stays rust, as an indicator, not an action |
| Errors | Stay rust-red; they are not an action |

**How, safely:** the same two stages as E. Stage 1 is a flagged CSS override
(exactly what the "after" screenshots use) with an allow-list for the active tab,
focus rings and progress bars. Stage 2 replaces the classes file by file by role,
starting with the athlete app, because the coach desktop has more screens that
need a decision about which button is primary.

**What the screenshots show:**

- Phone Home: "Log" (weigh-in) stops competing with Start workout. One clear
  orange button on the screen.
- Coach profile: outlined buttons ("Current program", "Upload exercise history",
  "This client's calendar") become quiet secondary controls, the profile links
  ("Recap & Up Next") read as links.

**Two things the screenshots also show, which need your call:**

1. On the coach profile there are still five solid orange buttons ("Log in-person
   session", "Schedule session", and the "Add to calendar" button on every Needs
   attention row). Limiting rust only helps if each screen has one primary. I'd
   demote "Schedule session" to outlined and make the Needs attention rows outlined,
   keeping "Log in-person session" as the profile's main action.
2. The active tab on the phone turned chalk and lost its highlight. That is why
   the active state is on the allow-list above. Keeping it rust is the right call.

## Suggested order

1. Approve E and F in principle (or change the rules above).
2. Ship E behind the flag, check phone and desktop, then flip it on.
3. Ship F stage 1 on the athlete app only, then decide the coach primaries (point 1 above), then stage 2.
4. Remove the flag and the redundant classes once both have been on for a week.
