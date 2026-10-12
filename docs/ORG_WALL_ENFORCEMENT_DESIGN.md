# Enforcing "the organization you are in" below the screens: design (not built)

Status: DESIGN ONLY. Nothing here is built. Ron decides.

## The gap this closes

Release AW makes the database refuse to show anything of an organization a person is not a member of. It cannot refuse a coach who legitimately belongs to TWO organizations, because to the database that person is a coach in both: it does not know which one they have open. Today the "open organization" lives only in the app (a cookie and the screens that read it, plus a guard test). A new screen that forgets to filter would mix the two organizations for that coach. The goal here is a second lock: the database itself narrows what a coach sees to the organization they have open.

## What it protects (and what it does not)

- It protects against our own mistakes: a screen, an API route or a report that reads "everything this coach can see" and so shows two organizations at once.
- It does not defend against the coach themselves: they are a real member of both organizations, so they could set the header by hand to the other one. That is acceptable, because they are allowed to see both, just not at once on the same screen.
- Owners, clients and one-organization coaches are unaffected.

## Options

### A. A per-request organization header read by the rules (recommended)

The app sends the open organization id with every database request. The platform that serves the database passes request headers to the rules, so a rule can ask "which organization did this request say it was for?" (`current_setting('request.headers')`). The shared helper functions that nearly every rule already calls (`is_group_coach`, `is_group_member`, `is_org_admin_of_group`, `is_org_member`) get one extra line: if a header is present, the group must belong to that organization. Because the rules all go through those helpers, about 60 rules change by changing 4 functions, not 60 policies.

- Where it is set: the browser client and the server client each read the `last_workspace_group` cookie, resolve it to an organization id, and send it as a header. One place (the two client factory files).
- No header (a person with no organization chosen, service jobs, the chooser page): behavior is today's, so nothing breaks while rolling out. A later step can make "no header and more than one organization" return nothing, so a missed client fails closed.
- Switching organization: the cookie changes, the next request carries the new header. Already-open pages keep working until they reload; the header is per request, not per session.
- Cost: about 2 days. Four functions, two client files, one server wrapper for routes that build their own client, tests that run every existing rehearsal once WITH the header and once without. Risk: moderate. A helper that is wrong for one caller makes that screen empty, so it needs the full rehearsal run plus a click-through of each coach screen.
- What it breaks / needs care:
  - Features that deliberately cross organizations: copying a program into another organization, moving a client between organizations, the organization chooser, the group switcher's "other organizations" list, the owner transfer screen. These need to send the other organization's id explicitly (or no header) for that one call.
  - Realtime and storage do not carry the header; they keep today's rules (storage is already keyed by the owner's folder, realtime by group membership and was audited clean).
  - Server routes using the service role bypass it, as they do all rules today; their own checks remain the protection.

### B. Put the organization in the sign-in token

A hook adds the open organization to the signed token, so the rules read it from there. Cleaner in principle, but a token is only reissued about hourly: switching organization would need a forced re-sign-in or token refresh each time, and the old token keeps the old organization until then. Not recommended for something a coach does several times a day.

### C. Organization-scoped views or functions for every read

Replace direct table reads with views or functions that take an organization id. Strongest, but it touches every query in the app (hundreds) and every screen would change at once. Cost is weeks. Not recommended before the pilot.

### D. Keep app-layer only (today)

The chooser, the remembered workspace, the shared helper `getActiveAnchor`, and the guard test that fails on any new unscoped read. Cheap, already done, but it depends on every future screen being written correctly.

## Recommendation

Do A after AW, AX and the current org-scope stack are live and Ron has used it for a week, and only if two-organization coaches (Ron himself, and anyone who joins two) are real in the pilot. Until then D plus the guard test is the protection. If Ron wants it, the first step is small and safe: add the header and the four helper lines with "no header = today's behavior", prove it with the rehearsal, ship, then decide whether to flip to fail-closed.

## Questions for Ron

1. Do coaches in the pilot belong to more than one organization, or only Ron?
2. If a screen needs two organizations at once on purpose (for example a combined "all my organizations" view for Ron), is that wanted? Option A would need a named exception for it.
