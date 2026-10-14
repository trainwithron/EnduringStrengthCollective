-- STEP 118: 0368 The one product shelf: where each package and Pro Shop card shows (public page, Client Home, Pro Shop) and who in the app sees it (everyone, not the one-on-one clients, only the one-on-one clients, one group); a program buyer can join the coach's client space
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the code that goes with it is live. Every existing package and Pro Shop card keeps showing exactly where it did, to everyone. Cards that are featured today are also marked for the public page, so no coach's public page changes. Run it BEFORE the code.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'audience'))) then
    raise exception 'Step 118 (0368) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0368_shelf_placement_and_audience.sql
-- ====================================================================================================

-- Release BX: the one product shelf. Where each thing a coach sells or shares shows, and who in the app sees it. Nothing about money changes in this release.
--
--   * coach_packages (a product: sessions, a program, or group access): show on the client's Home, show in the Pro Shop, who sees it (everyone / not the coach's one-on-one clients / only the one-on-one
--     clients / one group), and whether a buyer of a program also joins the coach's client space (default yes). "Public page" stays the existing is_public flag.
--   * pro_shop_links (a link card, for example Printful): show on the coach's public page, and the same audience. The existing Featured flag stays "Client Home and first in the shop"; the public page used
--     to show the featured cards, so every card that is featured today is also marked public now and nobody's public page changes.
-- Existing rows keep behaving exactly as before (everyone, same places). Re-runnable.

alter table public.coach_packages
  add column if not exists show_on_home boolean not null default false,
  add column if not exists show_in_pro_shop boolean not null default false,
  add column if not exists audience text not null default 'everyone',
  add column if not exists audience_group_id uuid references public.groups(id) on delete set null,
  add column if not exists buyer_joins_space boolean not null default true;

alter table public.pro_shop_links
  add column if not exists show_on_public boolean not null default false,
  add column if not exists audience text not null default 'everyone',
  add column if not exists audience_group_id uuid references public.groups(id) on delete set null;

alter table public.coach_packages drop constraint if exists coach_packages_audience_check;
alter table public.coach_packages add constraint coach_packages_audience_check
  check (audience in ('everyone', 'not_one_on_one', 'only_one_on_one', 'one_group') and (audience <> 'one_group' or audience_group_id is not null));

alter table public.pro_shop_links drop constraint if exists pro_shop_links_audience_check;
alter table public.pro_shop_links add constraint pro_shop_links_audience_check
  check (audience in ('everyone', 'not_one_on_one', 'only_one_on_one', 'one_group') and (audience <> 'one_group' or audience_group_id is not null));

-- The public page showed the featured cards: keep exactly that for every coach.
update public.pro_shop_links set show_on_public = true where featured = true and show_on_public = false;

commit;
