-- =========================================================
-- FIX: sign-up not creating a business
-- Run this ONCE in Supabase → SQL Editor (safe to re-run).
-- =========================================================

-- 1. Create a business row automatically whenever a user signs up.
--    SECURITY DEFINER lets it work even before the user has a session
--    (e.g. when email confirmation is on).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.businesses (owner_auth_id, name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'business_name', ''), 'My Business')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Backfill: any user who already signed up but has no business row
--    (e.g. from your earlier failed attempts) gets one now.
insert into public.businesses (owner_auth_id, name)
select u.id,
       coalesce(nullif(u.raw_user_meta_data->>'business_name', ''), 'My Business')
from auth.users u
where not exists (
  select 1 from public.businesses b where b.owner_auth_id = u.id
);
