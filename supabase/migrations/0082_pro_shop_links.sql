-- Pro Shop — a coach-curated directory of external links (merch store,
-- affiliate supplement links, coaching application forms, personal
-- website) so clients spend money through the coach's own ecosystem.
-- Same shape as referral_partners (0047): coach-scoped, shared across
-- every group that coach runs, click-tracked the same atomic way.
create table public.pro_shop_links (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category text not null default 'other'
    check (category in ('merch', 'supplements', 'coaching', 'website', 'other')),
  description text,
  url text not null,
  image_url text,
  discount_code text,
  discount_description text,
  sort_order int not null default 0,
  click_count int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.pro_shop_links enable row level security;

create policy "pro_shop_links_coach_manage" on public.pro_shop_links for all
  to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

create policy "pro_shop_links_client_select" on public.pro_shop_links for select
  to authenticated
  using (public.is_client_of_coach(coach_id));

create or replace function public.increment_pro_shop_click(p_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach_id uuid;
  new_count int;
begin
  select coach_id into v_coach_id from public.pro_shop_links where id = p_id;
  if v_coach_id is null then
    raise exception 'pro shop link not found';
  end if;
  if auth.uid() <> v_coach_id and not public.is_client_of_coach(v_coach_id) then
    raise exception 'not authorized';
  end if;

  update public.pro_shop_links
    set click_count = click_count + 1
    where id = p_id
    returning click_count into new_count;

  return new_count;
end;
$$;

-- Public bucket: product/storefront images render for every client on
-- every page load, same reasoning as org-branding (0080).
insert into storage.buckets (id, name, public, file_size_limit)
values ('pro-shop-images', 'pro-shop-images', true, 5242880) -- public, 5MB cap
on conflict (id) do nothing;

create policy "pro_shop_images_insert_own" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pro-shop-images'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  );

create policy "pro_shop_images_update_own" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'pro-shop-images'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  )
  with check (
    bucket_id = 'pro-shop-images'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  );

create policy "pro_shop_images_delete_own" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pro-shop-images'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  );
