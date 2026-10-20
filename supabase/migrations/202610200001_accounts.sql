-- MuQwiz account profile and per-user cloud snapshot.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  recovery_email text not null,
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-zA-Z0-9_]{3,24}$')
);

create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_data enable row level security;

-- Profiles are only visible/editable to their owner. Username resolution happens in Edge Function.
drop policy if exists "profile owner read" on public.profiles;
create policy "profile owner read" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "profile owner update" on public.profiles;
create policy "profile owner update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "user data owner read" on public.user_data;
create policy "user data owner read" on public.user_data for select to authenticated using (user_id = auth.uid());
drop policy if exists "user data owner insert" on public.user_data;
create policy "user data owner insert" on public.user_data for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "user data owner update" on public.user_data;
create policy "user data owner update" on public.user_data for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.profiles from anon;
revoke all on public.user_data from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.user_data to authenticated;

-- Pending usernames are kept server-side until email-confirmed account's first login.
create table if not exists public.username_reservations (
  username text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  recovery_email text not null,
  created_at timestamptz not null default now(),
  constraint reservation_username_format check (username ~ '^[a-z0-9_]{3,24}$')
);
alter table public.username_reservations enable row level security;
revoke all on public.username_reservations from anon, authenticated;
