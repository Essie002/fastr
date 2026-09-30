-- A hand-run probe of the constraints in the core schema, kept because it is the quickest way to
-- see the schema refuse bad data with your own eyes. The automated version of this is task 6.
--
--   npm run db:psql -- -f supabase/tests/manual/constraint-probe.sql
--
-- Every step marked "expect rejection" should print an ERROR naming the constraint that caught it,
-- and every step marked "expect acceptance" should print INSERT or UPDATE.
--
-- Read the errors by the line number in them, not by which \echo they appear under: psql writes
-- echoes to stdout and errors to stderr, so the two interleave and an error usually appears one
-- label late.
--
-- Also watch *which* constraint fires. A row can be rejected for the wrong reason and look like a
-- pass, which is what step 4's comment is about.

\set u '11111111-1111-4111-8111-111111111111'

delete from public.fasts where user_id = :'u';

\echo '1. first active fast (expect acceptance)'
insert into public.fasts (user_id, plan_id, goal_minutes, start_at, status)
values (:'u', '16:8', 960, now() - interval '2 hours', 'active');

\echo '2. a second active fast (expect rejection: one active fast per user)'
insert into public.fasts (user_id, plan_id, goal_minutes, start_at, status)
values (:'u', '18:6', 1080, now() - interval '1 hour', 'active');

\echo '3. a finished fast overlapping the active one (expect rejection: no overlap)'
insert into public.fasts (user_id, plan_id, goal_minutes, start_at, ended_at, status)
values (:'u', '16:8', 960, now() - interval '3 hours', now() - interval '1 hour', 'completed');

\echo '4. a goal of 4321 minutes, one over 72 hours (expect rejection: goal_minutes check)'
-- Note the end time. Written without one, this row trips fast_end_matches_status first and the goal
-- cap is never reached, which is exactly the false pass this comment exists to prevent.
insert into public.fasts (user_id, plan_id, goal_minutes, start_at, ended_at, status)
values (:'u', 'custom', 4321, now() - interval '400 hours', now() - interval '399 hours', 'completed');

\echo '4b. a goal of exactly 4320 minutes, 72 hours (expect acceptance)'
insert into public.fasts (user_id, plan_id, goal_minutes, start_at, ended_at, status)
values (:'u', 'custom', 4320, now() - interval '398 hours', now() - interval '397 hours', 'completed');

\echo '5. an end before its start (expect rejection)'
insert into public.fasts (user_id, plan_id, goal_minutes, start_at, ended_at, status)
values (:'u', '16:8', 960, now() - interval '300 hours', now() - interval '301 hours', 'completed');

\echo '6. an active fast carrying an end time (expect rejection)'
insert into public.fasts (user_id, plan_id, goal_minutes, start_at, ended_at, status)
values (:'u', '16:8', 960, now() - interval '500 hours', now() - interval '490 hours', 'active');

\echo '7. a finished fast that overlaps nothing (expect acceptance)'
insert into public.fasts (user_id, plan_id, goal_minutes, start_at, ended_at, status)
values (:'u', '16:8', 960, now() - interval '30 hours', now() - interval '13 hours', 'completed');

\echo '8. a custom goal off a 15-minute step (expect rejection)'
update public.profiles set custom_goal_minutes = 967 where id = :'u';

\echo '9. a custom goal on a 15-minute step (expect acceptance)'
update public.profiles set custom_goal_minutes = 975 where id = :'u';

\echo 'done. Rows left for this user:'
select status, count(*) from public.fasts where user_id = :'u' group by 1 order by 1;
