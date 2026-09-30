-- Local development seed. Requirement 20.7.
--
-- NEVER RUN THIS AGAINST A HOSTED PROJECT. It inserts users with a known password.
-- `supabase db reset` runs it against the local stack only; the deploy workflow uses `db push`,
-- which does not run seeds.
--
-- Two users rather than one, because the RLS suite needs a second account to fail against. That is
-- the whole reason user B exists: a test that only ever signs in as one user cannot prove isolation.

-- Password for both, bcrypt of 'fastr-local-dev'. Generated with:
--   select crypt('fastr-local-dev', gen_salt('bf'));
-- Hardcoded rather than computed so a reset produces the same hash every time and the value is
-- visible in review.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'a@fastr.test',
    crypt('fastr-local-dev', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Ada","time_zone":"Africa/Nairobi"}',
    now(), now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'b@fastr.test',
    crypt('fastr-local-dev', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Ben","time_zone":"Europe/London"}',
    now(), now()
  );

-- Auth requires a matching identity row, or sign-in with a password fails even though the user
-- exists. Easy to miss, and the failure looks like a wrong password.
insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
select
  gen_random_uuid(),
  u.id,
  u.id::text,
  'email',
  json_build_object('sub', u.id::text, 'email', u.email),
  now(), now()
from auth.users u
where u.email in ('a@fastr.test', 'b@fastr.test');

-- The profile trigger has already created both rows. Acknowledge the health notice so local
-- development is not gated behind it on every reset.
update public.profiles
   set health_notice_at = now(),
       notify_goal      = true
 where id in (
   '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222'
 );

-- A short history for Ada: five consecutive completed 16:8 fasts ending yesterday, so the streak,
-- history and stats screens have something real to render on a fresh machine. Generated relative to
-- now() so the data is never stale.
insert into public.fasts (user_id, plan_id, goal_minutes, start_at, ended_at, status, mood, energy)
select
  '11111111-1111-4111-8111-111111111111',
  '16:8',
  960,
  (current_date - offset_days)::timestamptz + time '20:00' - interval '16 hours',
  (current_date - offset_days)::timestamptz + time '20:00',
  'completed',
  4,
  4
from generate_series(1, 5) as offset_days;

-- One fast that missed its goal, so `metGoal` and the completion rate have a negative case.
insert into public.fasts (user_id, plan_id, goal_minutes, start_at, ended_at, status, mood, energy, note)
values (
  '11111111-1111-4111-8111-111111111111',
  '16:8',
  960,
  (current_date - 7)::timestamptz + time '20:00' - interval '16 hours',
  (current_date - 7)::timestamptz + time '18:00',
  'ended_early',
  2, 2,
  'Got a headache, stopped early.'
);
