-- MuQwiz: cloud quiz ownership.
-- Public users can read shared quizzes by link; only the signed-in owner can edit/delete.

alter table public.quizzes
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

alter table public.quizzes enable row level security;

-- Remove previous policies on this table so an older permissive UPDATE policy
-- cannot override the owner-only rule (Postgres permissive policies are OR-ed).
do $$
declare policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'quizzes'
  loop
    execute format('drop policy if exists %I on public.quizzes', policy_row.policyname);
  end loop;
end $$;

create policy "quizzes_select_shared"
  on public.quizzes for select
  using (true);

create policy "quizzes_insert_authenticated_owner"
  on public.quizzes for insert
  to authenticated
  with check (auth.uid() is not null and owner_id = auth.uid());

create policy "quizzes_update_owner_only"
  on public.quizzes for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "quizzes_delete_owner_only"
  on public.quizzes for delete
  to authenticated
  using (owner_id = auth.uid());
