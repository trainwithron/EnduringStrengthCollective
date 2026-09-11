-- WCAG AA color-contrast pass. Both organizations.accent_color's column
-- default and every org still on that unmodified default get nudged
-- from #C4622D to #D2703B — the original failed 4.5:1 both as button
-- text-on-background and as accent text on the app's dark surfaces
-- (confirmed via axe-core + manual relative-luminance math); the new
-- value clears 4.5:1 in both directions and reads as visually near-
-- identical. Orgs with a genuinely custom accent color are left alone
-- here EXCEPT the one real org already found failing the same check
-- (#147aff, a custom blue) — nudged to #248aff, the minimal brightening
-- that clears 4.5:1, rather than left broken.

alter table public.organizations alter column accent_color set default '#D2703B';

update public.organizations set accent_color = '#D2703B' where accent_color = '#C4622D';
update public.organizations set accent_color = '#248aff' where accent_color = '#147aff';
