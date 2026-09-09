-- One persistent, reusable join code per group, separate from the
-- existing short-lived per-invite codes a coach generates one at a time.
-- Lazily created (via the service-role client, since only coaches can
-- normally write invites) the first time any athlete expands/shares a
-- workout card, then reused by everyone in that group from then on —
-- printed as plain readable text on the shareable image so anyone
-- looking at the picture can join without scanning anything.
alter table public.groups add column public_invite_code text unique;
