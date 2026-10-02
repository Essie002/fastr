# Design Document

## Overview

Activity reminders add three tables, one generated reference list, two notification kinds and a rewritten scheduling
function. They add **no new infrastructure**: no service, no queue, no scheduler, no third-party account.

That is possible because the existing notification design separated two concerns that are easy to tangle. Filling the
queue is domain logic — it knows about fasts, stages and preferences. Draining it is not: `claim_due_notifications`
selects by `due_at` and `status`, the Edge Function composes text from a `kind`, and neither cares what the row means.
This feature writes a new producer and adds two cases to the composer. The claiming, the `for update skip locked`
concurrency, the staleness cut-off, the push fan-out, the dead-subscription cleanup and the failure counting are all
reused untouched.

The guiding principle is unchanged from the main spec: **the database is the application.** Schedules are rows,
occurrences are derived by SQL, and the constraint that stops a duplicate reminder is a unique index rather than a
careful `if`.

---

## Why the existing `reminders` table is not simply extended

It was the first thing considered, and it is the wrong shape for three reasons.

It has no concept of a thing being reminded about — no type, no label, no duration. Adding those makes it an activity
table with a misleading name, still joined to fasting-specific logic in `queue_due_reminders()`.

Its dedupe rule is "one reminder per user per local day", which is not a bug for one daily fasting reminder and is fatal
for four activities a day. That rule has to go, and removing it from a function that also serves fasting means changing
fasting behaviour in a feature that is not about fasting.

And it expresses one wall-clock time. Intervals need a window and a step, which is a second schedule shape. Putting two
shapes in one table with half the columns null for each is exactly the design that makes constraints unwriteable.

So: new tables, and the existing one left alone. Requirement 13 records that the duplication is deliberate.

---

## Data model

Four new relations. One is generated reference data; three hold user rows.

```
activity_types          generated, world-readable   key, label, icon, default_minutes, unit
activities              one per thing a user cares about
activity_schedules      one or more per activity; two shapes, discriminated
activity_log            completions
```

### `activity_types` — generated, not authored

Mirrors `fasting_stages` exactly, for the same reason: the list has to exist in three runtimes. The browser needs labels
and icons, Postgres needs it to validate a foreign key, and the Edge Function needs labels to compose notification text
without a database round trip per row.

Source of truth is `packages/shared/src/activities.ts`. `scripts/gen-activities.mjs` writes:

1. `supabase/migrations/<ts>_activity_types.sql` — `create table if not exists`, `truncate`, `insert`, RLS on with
   `for select using (true)`
2. `supabase/functions/_shared/activityTypes.ts`

Both carry the `GENERATED FILE` header, and CI's existing `git diff --exit-code -- supabase/migrations
supabase/functions/_shared` catches a stale copy once `npm run gen:activities` is added to that step.

```sql
create table if not exists public.activity_types (
  key             text    primary key,
  label           text    not null,
  icon            text    not null,
  default_minutes integer not null check (default_minutes between 1 and 480),
  -- 'minutes' for everything you spend time on; 'ml' for water, which is measured in volume and
  -- whose completions are written to water_entries instead of being timed.
  unit            text    not null check (unit in ('minutes', 'ml')),
  sort_order      integer not null
);
```

The v1 list: `walk`, `run`, `cycle`, `swim`, `stretch`, `strength`, `water`.

`water` is in the same table rather than special-cased elsewhere, so the UI iterates one list. Its `unit` is what makes
it behave differently, and that difference is confined to two places: what the completion form asks for, and where the
completion is written.

### `activities`

```sql
create table public.activities (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,

  -- Null for a custom activity. A foreign key rather than free text so a typo cannot
  -- produce an activity the notification composer has no copy for.
  type_key      text        references public.activity_types (key),

  -- Set only for a custom activity. The two are mutually exclusive, enforced below.
  custom_label  text        check (custom_label is null or char_length(btrim(custom_label)) between 1 and 40),

  duration_minutes integer  not null check (duration_minutes between 1 and 480),

  -- Requirement 4.3. Off by default, deliberately.
  notify_end    boolean     not null default false,

  enabled       boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Exactly one of the two naming routes. Without this a row can be both, or neither,
  -- and the label shown to the user becomes a coin toss.
  constraint activity_named_once check (
    (type_key is not null and custom_label is null) or
    (type_key is null     and custom_label is not null)
  )
);
```

`on delete cascade` from `auth.users` matches every other table, so account deletion stays one statement.

The 20-activity limit (Requirement 1.7) is **not** a CHECK constraint — a CHECK cannot count other rows. It is enforced
in a `before insert` trigger, because enforcing it only in the client means the limit does not exist.

### `activity_schedules`

Two shapes in one table, discriminated by `kind`, with each shape's columns required and the other's forbidden. This is
the design that makes the constraint writeable, and it is why the schedule is a separate table from the activity:
attaching two shapes' worth of nullable columns to `activities` would have made *that* table unconstrainable.

```sql
create table public.activity_schedules (
  id           uuid        primary key default gen_random_uuid(),
  activity_id  uuid        not null references public.activities (id) on delete cascade,

  -- Denormalised from activities so RLS and the queue function need no join. The trigger below
  -- keeps it honest; without it this is a hole where a row could be attributed to another user.
  user_id      uuid        not null references auth.users (id) on delete cascade,

  kind         text        not null check (kind in ('at', 'every')),

  -- 0 is Sunday, matching extract(dow) and the existing reminders table.
  weekdays     smallint[]  not null check (
                 cardinality(weekdays) between 1 and 7
                 and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
               ),

  -- kind = 'at'
  local_time   time,

  -- kind = 'every'
  window_start time,
  window_end   time,
  interval_minutes integer check (interval_minutes between 15 and 720),

  enabled      boolean     not null default true,
  created_at   timestamptz not null default now(),

  constraint schedule_shape check (
    (kind = 'at'
       and local_time is not null
       and window_start is null and window_end is null and interval_minutes is null)
    or
    (kind = 'every'
       and local_time is null
       and window_start is not null and window_end is not null and interval_minutes is not null
       -- Requirement 3.2. A window shorter than the interval can never fire twice, which is a
       -- schedule the user did not mean. Refused at write time rather than silently degraded.
       and window_end > window_start
       and (extract(epoch from (window_end - window_start)) / 60) >= interval_minutes)
  )
);
```

The `user_id` denormalisation earns its keep twice: the RLS policy is `user_id = auth.uid()` with no subquery, and
`queue_due_reminders` joins schedules straight to profiles. A `before insert or update` trigger sets it from the parent
activity rather than trusting the client to send it.

### `activity_log`

```sql
create table public.activity_log (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,

  -- Kept when the activity is deleted (Requirement 1.6): history is a record of what
  -- happened, and deleting a schedule is not a claim that the swim never occurred.
  activity_id uuid        references public.activities (id) on delete set null,

  -- Snapshotted, because activity_id can become null and a history row still has to render.
  label       text        not null check (char_length(btrim(label)) between 1 and 40),
  type_key    text        references public.activity_types (key),

  occurred_at timestamptz not null,
  minutes     integer     check (minutes between 1 and 1440),

  -- Requirement 5.3. 'strava' exists from the start so that adding the integration later
  -- is additive rather than a migration of historical rows.
  source      text        not null default 'manual' check (source in ('manual', 'strava')),
  external_id text,

  note        text        check (note is null or char_length(note) <= 280),
  created_at  timestamptz not null default now(),

  -- Idempotency for a future import: the same third-party activity must not land twice.
  constraint external_id_needs_source check (external_id is null or source <> 'manual')
);

create unique index activity_log_external
  on public.activity_log (user_id, source, external_id)
  where external_id is not null;
```

The label snapshot is the interesting choice. Joining to `activities` for the label would be normal and would break the
moment an activity is deleted or renamed — history would retitle itself retroactively. A log is a record of what was
true then.

Water completions do **not** go here. Requirement 5.6 says a water completion writes a `water_entries` row through the
existing feature, because water already has a goal, a daily total and a UI. Two sources of truth for how much someone
drank would be a bug waiting to be discovered.

### RLS

Every table gets the project's uniform four owner-scoped policies on `user_id = auth.uid()`, except:

- `activity_types`: `for select using (true)`, like `fasting_stages`. Reference data about nobody.
- `activity_schedules`: four policies on its denormalised `user_id`.
- `activity_log`: four policies, so a mistaken entry can be deleted.

`notifications` keeps its select-only client policy. Activity notifications are written by the queue function, which is
`security definer`.

### Realtime

`public.activities` and `public.activity_schedules` are added to the `supabase_realtime` publication with `replica
identity full`, so editing a schedule on a laptop updates the phone. `activity_log` is not: completions are written by
the device the user is holding, and the existing refetch-on-focus is enough.

---

## Scheduling

### The constraint changes that unblock it

Three, each a one-line consequence of a decision recorded in Requirement 11.

```sql
-- Was: any kind other than 'reminder' must have a fast_id. That rejected activity rows outright.
alter table public.notifications drop constraint reminder_has_no_fast;

alter table public.notifications
  add column activity_schedule_id uuid references public.activity_schedules (id) on delete cascade,
  add column activity_id          uuid references public.activities (id) on delete cascade;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (
    kind in ('goal', 'stage', 'hour_before', 'reminder', 'activity_start', 'activity_end')
  );

-- Each kind carries exactly the reference it needs, and nothing else.
alter table public.notifications
  add constraint notification_reference check (
    (kind in ('goal', 'stage', 'hour_before')
       and fast_id is not null and activity_schedule_id is null)
    or
    (kind = 'reminder'
       and fast_id is null and activity_schedule_id is null)
    or
    (kind in ('activity_start', 'activity_end')
       and fast_id is null and activity_schedule_id is not null and activity_id is not null)
  );

-- Requirement 3.4. The dedupe is an index, not logic, so re-running the queue function cannot
-- duplicate an occurrence no matter how the function is rewritten later.
create unique index notifications_unique_per_occurrence
  on public.notifications (activity_schedule_id, kind, due_at)
  where activity_schedule_id is not null and status in ('pending', 'sent');
```

That last index is what lets the queue function be a plain `insert ... on conflict do nothing` with no bookkeeping, and
it is what replaces the "one reminder per user per day" rule rather than reproducing it.

### Deriving occurrences

Both schedule shapes reduce to a set of instants, and `generate_series` does the interval case, which is the whole
reason this is tractable in SQL.

```sql
create or replace function public.activity_occurrences(
  from_at timestamptz,
  to_at   timestamptz
)
returns table (
  schedule_id uuid,
  activity_id uuid,
  user_id     uuid,
  due_at      timestamptz,
  minutes     integer,
  notify_end  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with local as (
    select
      s.id   as schedule_id,
      a.id   as activity_id,
      s.user_id,
      s.kind,
      s.local_time,
      s.window_start,
      s.window_end,
      s.interval_minutes,
      a.duration_minutes as minutes,
      a.notify_end,
      p.time_zone,
      -- The user's current local date, which is the anchor every occurrence is built from.
      (now() at time zone p.time_zone)::date as local_day,
      extract(dow from now() at time zone p.time_zone)::smallint as local_dow,
      s.weekdays
    from activity_schedules s
    join activities a on a.id = s.activity_id
    join profiles   p on p.id = s.user_id
    where s.enabled and a.enabled
  ),
  due as (
    -- One occurrence per day.
    select schedule_id, activity_id, user_id, minutes, notify_end,
           ((local_day + local_time) at time zone time_zone) as due_at
      from local
     where kind = 'at' and local_dow = any (weekdays)

    union all

    -- Every `interval_minutes` from window_start, up to and including window_end.
    -- generate_series is inclusive of the end only when it lands exactly on a step, which is
    -- the behaviour Requirement 3.5 asks for: never past the window.
    select l.schedule_id, l.activity_id, l.user_id, l.minutes, l.notify_end, slot
      from local l
      cross join lateral generate_series(
        (l.local_day + l.window_start) at time zone l.time_zone,
        (l.local_day + l.window_end)   at time zone l.time_zone,
        make_interval(mins => l.interval_minutes)
      ) as slot
     where l.kind = 'every' and l.local_dow = any (l.weekdays)
  )
  select schedule_id, activity_id, user_id, due_at, minutes, notify_end
    from due
   where due_at >= from_at and due_at <= to_at;
$$;
```

Separating this from the insert is deliberate: it is a pure function of the clock and the schedules, so a test can ask
"what occurrences does this schedule produce on this day in this zone" and get an answer without writing a notification.
That is how Requirement 8.3's daylight-saving case gets tested — the arithmetic lives in `at time zone`, which is
Postgres's job and is correct, and the test asserts it rather than the test reimplementing it.

### Queueing

```sql
create or replace function public.queue_due_activities()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  queued integer;
begin
  with occ as (
    -- A five-minute look-back absorbs a late cron run; twenty minutes ahead covers the
    -- fifteen-minute cadence with overlap, so a skipped run does not drop an occurrence.
    select * from activity_occurrences(now() - interval '5 minutes', now() + interval '20 minutes')
  ),
  starts as (
    insert into notifications (user_id, activity_id, activity_schedule_id, kind, due_at)
    select user_id, activity_id, schedule_id, 'activity_start', due_at from occ
    on conflict do nothing
    returning 1
  ),
  ends as (
    insert into notifications (user_id, activity_id, activity_schedule_id, kind, due_at)
    select user_id, activity_id, schedule_id, 'activity_end',
           due_at + make_interval(mins => minutes)
      from occ
     where notify_end
    on conflict do nothing
    returning 1
  )
  select (select count(*) from starts) + (select count(*) from ends) into queued;

  return queued;
end;
$$;
```

Scheduled every fifteen minutes (Requirement 3.6), alongside the existing hourly fasting reminder job, which is left
exactly as it is:

```sql
perform cron.schedule('fastr-queue-activities', '*/15 * * * *',
                      $job$ select public.queue_due_activities(); $job$);
```

### Cancelling

A trigger on `activities` and `activity_schedules` mirrors `sync_fast_notifications`: when a schedule or activity is
disabled, deleted, or has its time changed, pending notifications for it are cancelled. Already-sent rows are left, being
history.

```sql
update notifications
   set status = 'cancelled'
 where activity_schedule_id = old.id
   and status = 'pending';
```

Requirement 8.2's time-zone change is the same mechanism, hung off a profile update of `time_zone`: cancel this user's
pending activity notifications and let the next cron run requeue them in the new zone. Cancelling rather than recomputing
is the right move because the next run is at most fifteen minutes away and recomputation would duplicate the occurrence
logic in a second place.

---

## Notifications

### The three-runtime `kind` problem

`notifications.kind` is a text CHECK duplicated in the migration, `packages/shared/src/types.ts`, and the Edge Function's
own inline union — and **nothing checks that the three agree**. A kind added to two of them produces either a constraint
violation at insert or a notification with no text, and the Edge Function's `compose` has no `default` case, so a missing
branch returns `undefined` and the push goes out blank.

Requirement 12.2 and 12.3 fix both halves. A test reads the CHECK constraint out of the migration SQL, the union out of
the shared package and the union out of the Edge Function, and asserts the three sets are equal. And `compose` gets an
exhaustiveness guard:

```ts
default: {
  const unreachable: never = row.kind;
  throw new Error(`No notification copy for kind: ${String(unreachable)}`);
}
```

That turns a forgotten branch into a type error at build time, and a genuinely unknown kind into a loud server error
rather than an empty notification on someone's phone.

### Copy

Composed at send time from `activityTypes.ts` and the row, as the existing kinds are, so re-wording is a deploy rather
than a migration.

| Kind | Title | Body |
| --- | --- | --- |
| `activity_start` | `Time for a swim` | `45 minutes` |
| `activity_start`, custom | `Time for: Physio` | `20 minutes` |
| `activity_start`, water | `Time to drink water` | `Your goal is 2 L today` |
| `activity_end` | `Swim done?` | `Tap to log it` |

Tags are `activity-${activity_id}` for starts and `activity-end-${activity_id}` for ends, so a phone left unattended
replaces rather than stacks (Requirement 4.6).

The payload gains a `url`, which the sender already supports: `/history` for a normal activity, `/` for water so the
notification lands on the water logger (Requirement 4.7).

### The preference switch

One new profile column, `notify_activities boolean not null default true`, read by `queue_due_activities` the way
`sync_fast_notifications` reads `notify_goal`. Independent of the fasting preferences per Requirement 4.8, because
someone who wants a fast-goal alert and no activity nagging should not have to delete their schedules.

---

## Front end

```
routes/
  Activities.tsx        List, add, edit, enable/disable (Req 7)
components/
  ActivityForm.tsx      Type picker, duration, end-reminder toggle
  ScheduleFields.tsx    The 'at' / 'every' discriminated form
  ActivityList.tsx      Rows with next-occurrence and a one-tap disable
  LogActivityButton.tsx Record a completion
data/
  activities.ts         Queries and mutations
  activityLog.ts        Completions, and the water special case
```

`Activities` becomes a sixth tab. The nav already wraps and the segmented control already handles narrow screens, both
fixed earlier, so six tabs need no layout work on a 390px phone — to be confirmed by measurement, not assumed.

Two pieces of logic worth naming:

**Next occurrence** (Requirement 7.4) is computed client-side from the schedule, duplicating the SQL. That is a real
duplication and it is accepted: the alternative is a round trip to render a list. A shared test asserts the TypeScript
and the SQL agree on the same fixtures, which is the same bargain the project already makes for validation rules.

**Describing a schedule** reuses `describeWeekdays()` from `data/reminders.ts`, which already produces "Every day",
"Weekdays" and "Weekends". It moves to `packages/shared` so both reminder systems use one copy.

---

## Testing

| Claim | How it is proved |
| --- | --- |
| Occurrences are right, including across DST | `activity_occurrences` called against real Postgres with fixed zones and dates |
| An occurrence is queued exactly once | Call `queue_due_activities` repeatedly; assert row counts do not grow |
| Shapes are enforced | Insert each invalid combination; assert Postgres refuses |
| Zod and Postgres agree | Parity test, as the project already does |
| RLS holds | Two real users; each new table; read, write, delete attempts |
| Kinds agree across three runtimes | Test parses the migration, the shared union, and the Edge Function union |
| `compose` is exhaustive | Type-level `never` guard plus a test per kind |
| Fasting is undamaged | Existing suites pass unchanged |
| Screens are accessible | axe on each new screen; contrast test covers new pairs |
| Export round-trips | Export, import into a clean user, compare |

---

## Risks and what is done about them

**Too many notifications.** The real failure mode for this feature is that it becomes annoying and the user turns off
notifications entirely, losing fasting alerts too. Mitigated by the end reminder being off by default, by one tag per
activity so they replace, by the independent master switch, and by the 20-activity limit.

**An interval schedule misconfigured into a flood.** A 15-minute interval across a 16-hour window is 64 notifications a
day, and it is a legal schedule. The form will show the resulting count before saving — the cheapest possible guard, and
better than a limit that stops a legitimate use.

**Clock and zone bugs.** The most likely source of a wrong-time reminder. Everything stays in wall-clock time resolved
through `at time zone` at queue time, nothing is stored as an instant, and the DST case is tested rather than reasoned
about.

**Scope creep toward a fitness tracker.** Fastr is a fasting app with a reminder feature, not a training log. The
excluded list in the requirements is the defence, and `activity_log` holding only a label, a time and a duration is the
structural version of it.

**The cron cadence quadruples.** From one run an hour to four. Each run is one `insert ... select` over a small set of
enabled schedules, and the fasting sender already runs every minute, so this is not a meaningful change in load.
