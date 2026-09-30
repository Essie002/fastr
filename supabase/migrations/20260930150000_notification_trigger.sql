-- Queueing notifications. Requirements 5.3, 7.4, 7.5, 7.6.
--
-- Requirement 7.6 asks for the queue to change in the same transaction as the fast. That rules out
-- the browser doing it: a phone that starts a fast and then loses signal would leave a fast with no
-- notification queued and nothing to reconcile it later. So a trigger owns the queue, and the client
-- cannot write to `notifications` at all (it has a select policy and nothing else).

create or replace function public.sync_fast_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  stage   record;
  goal_at timestamptz;
  prefs   record;
begin
  -- --------------------------------------------------------------------------
  -- Time sanity, which cannot be a CHECK constraint because now() is not immutable
  -- --------------------------------------------------------------------------

  -- A minute of slack, because a client clock that is slightly ahead is normal and rejecting it
  -- would fail a legitimate "start now" with an error the user cannot act on.
  if new.start_at > now() + interval '1 minute' then
    raise exception 'A fast cannot start in the future.'
      using errcode = 'check_violation';
  end if;

  if new.ended_at is not null and new.ended_at > now() + interval '1 minute' then
    raise exception 'A fast cannot end in the future.'
      using errcode = 'check_violation';
  end if;

  -- Requirement 5.3's 48-hour limit applies to *starting* a fast, where the user is saying "I
  -- stopped eating at 8pm". It must not apply to a finished fast being added by hand, because
  -- Requirement 9.4 lets a user log a fast from months ago. Conflating the two would make the
  -- history screen's "add a past fast" refuse anything older than two days.
  if tg_op = 'INSERT' and new.status = 'active'
     and new.start_at < now() - interval '48 hours' then
    raise exception 'A fast being started cannot have begun more than 48 hours ago.'
      using errcode = 'check_violation';
  end if;

  -- --------------------------------------------------------------------------
  -- Requeue
  -- --------------------------------------------------------------------------

  -- Whatever was pending for this fast reflects its old times and is now wrong. Cancelled rather
  -- than deleted, so what was scheduled stays visible when working out why an alert did or did not
  -- arrive.
  update notifications
     set status = 'cancelled'
   where fast_id = new.id
     and status = 'pending';

  -- Finished or abandoned: nothing further is due. The cancel above has already cleared the queue.
  if new.status <> 'active' then
    return new;
  end if;

  select notify_goal, notify_stages, notify_hour_before
    into prefs
    from profiles
   where id = new.user_id;

  if not found then
    -- No profile means no preferences to honour. The fast is still valid; it simply queues nothing.
    return new;
  end if;

  goal_at := new.start_at + make_interval(mins => new.goal_minutes);

  -- Every insert below is guarded by `due_at > now()`. Without it, editing a fast's start time
  -- backwards queues a pile of alerts that are already overdue, and the sender would then have to
  -- decide whether to fire them. Requirement 7.8's staleness rule is a safety net for a paused
  -- project, not a substitute for not queueing the past.

  if prefs.notify_goal and goal_at > now() then
    insert into notifications (user_id, fast_id, kind, due_at)
    values (new.user_id, new.id, 'goal', goal_at)
    on conflict do nothing;
  end if;

  if prefs.notify_hour_before and goal_at - interval '1 hour' > now() then
    insert into notifications (user_id, fast_id, kind, due_at)
    values (new.user_id, new.id, 'hour_before', goal_at - interval '1 hour')
    on conflict do nothing;
  end if;

  -- Requirement 7.4. Only stages that fall inside this fast's goal: a 16-hour fast has no business
  -- announcing ketosis at 18 hours.
  if prefs.notify_stages then
    for stage in
      select key, at_minutes
        from fasting_stages
       where at_minutes > 0              -- the stage at zero is where every fast starts
         and at_minutes <= new.goal_minutes
       order by at_minutes
    loop
      if new.start_at + make_interval(mins => stage.at_minutes) > now() then
        insert into notifications (user_id, fast_id, kind, stage_key, due_at)
        values (
          new.user_id, new.id, 'stage', stage.key,
          new.start_at + make_interval(mins => stage.at_minutes)
        )
        on conflict do nothing;
      end if;
    end loop;
  end if;

  return new;
end;
$$;

-- `after`, not `before`: the exclusion constraint and the check constraints must have accepted the
-- row before anything is queued for it, or a rejected fast could leave notifications behind.
--
-- Scoped to the three columns that change what is due. Updating a note or a mood rating should not
-- tear down and rebuild the queue.
create trigger fasts_sync_notifications
  after insert or update of start_at, goal_minutes, status on public.fasts
  for each row execute function public.sync_fast_notifications();

-- A fast deleted takes its notifications with it through the cascade on notifications.fast_id, so
-- there is no delete branch here.
