# Offboarding and handoff (design, not built)

Ron: "easy to leave is a big promise; the owner must be able to do everything."

## 1. What exists today (read from the code, Oct 16)

- The owner CAN delete or change an `organization_memberships` row (policies `org_memberships_delete_owner` / `_update_owner`, 0110). There is no screen for it, and deleting the row does NOT remove the person's coach seat in the organization's groups (`group_memberships`). So "remove a trainer" would leave them reading their clients' data. This is the hole.
- `leave_organization(p_org)` (0352): a member removes their own coach seats and membership. It refuses for the owner, and refuses a coach who is the only coach of a group that has clients (so a trainer with clients cannot leave).
- `transfer_organization_ownership` exists (0099/0217). No screen found that calls it.
- `move_client_to_group` (0378): the caller must coach BOTH groups, and a one-on-one group holds one client, so an owner who does not coach the trainer's one-on-one group cannot hand that client over.
- `organization_invites` (0352): owner/admin can read open invites. No list screen, no resend, no revoke.
- No close-organization path. No role-change screen. No org data export.

## 2. The one screen: Team (owner and admins)

One list, one row per member: name, role, number of clients, last active. Actions on a row: **Change role**, **Hand over clients**, **Remove**. Below it, **Pending invites** (Resend, Cancel). At the bottom, **Export our data** and **Close this organization** (owner only).

Plain words (to confirm with Ron):
- Remove: "Remove Sam from {Org}? Sam loses access to every client here right away. Sam's {n} clients stay with {Org}. Choose who takes them." [Choose a trainer] [Remove] 
- Hand over: "Move {n} clients from Sam to {Trainer}. Their history, credits and programs go with them."
- Trainer leaving: same hand-over step first, then "You have left {Org}."
- Private clients: "{n} of Sam's clients keep their records private from {Org}. We cannot move them for you. They will be asked to choose a coach." 
- Close: type the organization's name. "Closing {Org} removes every trainer's access to the others' clients. Each trainer keeps their own clients as a solo coach. Download your data first." 

## 3. What the database does (one paste, Release CL, step 136, migration 0385)

1. Split `move_client_to_group` into an internal core (the current body) plus the existing wrapper (caller coaches both groups). Add `reassign_client(athlete, from, to)`: the caller is owner/admin of the organization that holds both groups. Refuses a client who is private from the organization.
2. `remove_org_member(org, profile, hand_to)`: owner/admin only (only the owner removes an admin; nobody removes the owner). In one transaction: hand every client the person solely coaches to `hand_to` (shared groups just lose the seat; one-on-one clients move to `hand_to`'s one-on-one), delete their coach seats in the organization's groups, delete their open invites and organization membership, revoke their organization API keys. Refuses with a plain message if a client needs a home and `hand_to` is missing.
3. `leave_organization` keeps its rule but now offers the same hand-over (`hand_to`) instead of refusing.
4. `set_org_member_role(org, profile, role)`: owner/admin; never the owner; never leaves the organization with no admin or owner. Audited.
5. `resend_org_invite` / `cancel_org_invite`: owner/admin.
6. `close_organization(org)`: owner only. Removes every other member's seat across others' groups, sets every group's organization to null (each trainer keeps their own clients), marks the organization closed, cancels its subscription (server side). History, credits and programs live on the group, so they follow it.
7. Audit: add a delete mode to the audit trigger on `organization_memberships` so removals are recorded with who did it.

## 4. Decisions for Ron

- When a trainer is removed, do their clients stay with the gym (recommended, and what this design does) or may the trainer take them? (Clients who are private from the organization are never moved by the owner either way.)
- Closing the organization: each trainer keeps their own clients as a solo coach (recommended) or the clients are archived.

## 5. Size

Medium-large: one paste, one Team page, five server functions, tests, a rehearsal for each function. Export (#10) reuses the coach CSV export being built for import/migration, so it is built once.
