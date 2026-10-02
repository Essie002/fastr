# Requirements Document

## Introduction

This spec covers **activity reminders** for Fastr: a user chooses activities they want to do — a walk, a swim, a bike
ride, a stretch, drinking water — and Fastr reminds them at the times they ask for, then lets them record that they did it.

Fasting already works this way for one thing: start a fast, get told when it is done, build a history. This feature
generalises that to everything else the user wants to keep doing, using the notification machinery that already exists.

### What this spec covers

Preset and custom activity types, two kinds of schedule (a wall-clock time on chosen weekdays, and a repeating interval
inside a daily window), an optional end reminder per activity, recording completions, activity history and simple stats,
settings, data export and import, and the migration of the existing fasting reminder.

### What this spec explicitly excludes

- **Strava and any other third-party integration.** Specified separately in Requirement 14 as a deliberate non-goal for
  this spec, with the reasoning recorded so the decision is not revisited by accident.
- **Live activity tracking.** Fastr does not record a route, a distance, a heart rate, or a GPS trace. It records that an
  activity happened and for how long. Anything richer is the job of a device that was actually strapped to the user.
- **Exercise prescription.** Fastr does not suggest what to do, how hard, or how often. The user decides; Fastr reminds.
- **Rest-day or progression logic.** No training plans, no load management, no "you should take today off".
- **Replacing the fasting reminder.** See Requirement 13: it stays where it is, on purpose.

### Architecture in one paragraph

Nothing new is needed. The existing design already owns the hard parts: `notifications` is a database-owned queue,
`pg_cron` drives SQL functions that fill it, and one Edge Function drains it over Web Push. All of that is already
indifferent to what a notification is *about* — `claim_due_notifications`, the staleness rule and the push fan-out need no
changes at all. What this feature adds is three tables, one generated reference list, two new notification kinds, and a
rewritten queue function. The security boundary is unchanged and remains Row Level Security.

### Key decisions, and why

These four were open questions. They are settled here so the design does not relitigate them.

1. **Presets *and* custom.** A fixed list gets real icons and specific notification copy ("Time for a swim" rather than
   "Time for your activity"), and it can be single-sourced in `packages/shared` and generated into both SQL and the Edge
   Function by the generator that already does fasting stages. A free-text-only design cannot have either. Custom
   activities exist so the list is not a cage, and they accept the generic icon and generic copy as the price.

2. **Duration on the start notification; the end reminder is opt-in per activity, off by default.** Two notifications for
   every activity is the wrong default: a phone buzzing as someone climbs out of a pool is worse than useless, and the
   fastest way to make a user disable notifications entirely is to send too many. But an end nudge is genuinely useful for
   an activity bounded by something other than the activity — a twenty-minute walk inside a lunch break — so it is offered
   rather than forbidden.

3. **The fasting reminder stays separate.** Folding it in would be tidier conceptually and is rejected anyway: it would
   require migrating existing user rows, and it would change `reminderSchema`, `exportSchema` and the `import-data`
   function, breaking compatibility with every export already downloaded. Its one piece of real logic — suppress the
   reminder while a fast is already running — is specific to fasting and does not generalise. The tables below are
   nonetheless shaped so that it *could* become an activity later; see Requirement 13.

4. **Intervals are supported, and the cron cadence changes to suit.** "Drink water every two hours" is the request;
   expressing it as six hand-entered times would be a worse feature than not having it. The existing schedule function
   runs hourly, which cannot place a reminder at 10:30, so it moves to every fifteen minutes with a shorter lookahead.
   This also removes the existing "one reminder per user per local day" rule, which is a workaround that would otherwise
   collapse four activities a day into one notification.

### Key context and constraints

- **Three constraints in the current schema actively block this feature** and are dealt with in Requirement 11. The
  `reminder_has_no_fast` CHECK requires every notification kind except `'reminder'` to carry a `fast_id`, so an activity
  notification would be rejected outright. The dedupe in `queue_due_reminders()` is per user per day rather than per
  schedule, so several activities a day collide. And `notifications_unique_per_fast` is `where fast_id is not null`, so
  activity rows would have no duplicate protection at all.
- **`notifications.kind` is a text CHECK constraint duplicated in three runtimes** — the migration, `packages/shared`, and
  the Edge Function's own union and `switch`. Nothing checks that the three agree, so Requirement 12 adds a parity test.
- **Water already exists.** There is a `water_entries` table and a `water_goal_ml` on the profile. A water reminder must
  drive that existing feature, not a parallel copy of it.
- **`npm run check:rls` fails CI** if any table in `public` lacks RLS or has no policies, so every new table ships its
  policies in the same migration.
- **Realtime publishes only `public.fasts`.** Anything wanting cross-device liveness must be added to the publication.
- **The free Supabase plan sends two emails an hour** and pauses after a week idle. Neither affects Web Push, which is what
  this feature uses, but the project pause does stop notifications — already documented, and unchanged here.

---

## Requirement 1: Choosing what to be reminded about

**User Story:** As someone trying to move more, I want to tell Fastr which activities I care about, so that it reminds me
about those and not about a generic to-do list.

### Acceptance Criteria

1. The system SHALL offer a preset list of activity types, each with a key, a display label, an icon, and a default
   duration in minutes. The v1 list SHALL be: walk, run, cycle, swim, stretch, strength, and water.
2. The preset list SHALL be defined once in `packages/shared` and generated into a SQL migration and into the Edge
   Function's shared directory, by the same generator pattern used for fasting stages. The generated files SHALL NOT be
   hand-edited, and CI SHALL fail if they are stale.
3. WHEN a user adds an activity THEN they SHALL be able to choose a preset type, or choose "something else" and supply
   their own label of 1 to 40 characters.
4. A custom activity SHALL use a generic icon and generic notification copy. The system SHALL NOT pretend to know what a
   custom activity is.
5. Each activity SHALL have a duration in minutes, defaulting to its preset's default and editable between 1 and 480.
6. A user SHALL be able to disable an activity without deleting it, and deleting it SHALL remove its schedules and its
   pending notifications but SHALL NOT remove its completion history.
7. The system SHALL impose a limit of 20 activities per user, and SHALL say so rather than failing silently when reached.

## Requirement 2: Scheduling by wall-clock time

**User Story:** As someone who swims on Tuesday mornings, I want a reminder at a specific time on specific days, so that it
fits the week I actually have.

### Acceptance Criteria

1. An activity SHALL support a schedule of one local time plus one or more weekdays, where 0 is Sunday to match
   Postgres `extract(dow from ...)` and the existing `reminders` table.
2. The local time SHALL be interpreted in the user's own time zone from their profile, which SHALL be an IANA zone name so
   that daylight saving transitions are handled by Postgres rather than by arithmetic.
3. An activity SHALL support more than one schedule, so that "swim Tuesday 07:00 and Saturday 09:00" is one activity rather
   than two.
4. WHEN a schedule's time arrives THEN the system SHALL queue a start notification for that occurrence, and SHALL do so
   exactly once however many times the queue function runs.
5. The system SHALL NOT queue a notification for a time that has already passed by more than the staleness window, so that
   enabling an activity in the evening does not fire that morning's reminder.

## Requirement 3: Scheduling by interval

**User Story:** As someone who forgets to drink water, I want a nudge every couple of hours during the day, so that I do not
have to enter six separate times.

### Acceptance Criteria

1. An activity SHALL support a repeating schedule expressed as an interval in minutes together with a daily start time and
   a daily end time, on chosen weekdays.
2. The interval SHALL be between 15 and 720 minutes, and the system SHALL reject a window shorter than the interval rather
   than creating a schedule that can never fire twice.
3. Occurrences SHALL be derived deterministically from the window start and the interval, so that the same schedule always
   produces the same times and re-running the queue function cannot create duplicates.
4. The system SHALL queue no more than one notification per schedule per occurrence time, enforced by a database
   constraint rather than by the queue function's own logic.
5. The last occurrence SHALL fall at or before the window end. The system SHALL NOT queue a reminder after the window has
   closed.
6. The scheduling function SHALL run at least every fifteen minutes, so that an interval schedule can place an occurrence
   on a quarter hour rather than only on the hour.

## Requirement 4: Being reminded

**User Story:** As a user with a schedule set, I want the reminder to arrive on my phone and tell me something useful, so
that I can act on it without opening the app.

### Acceptance Criteria

1. A start notification SHALL name the activity and state its duration, for example "Swim — 45 minutes".
2. A custom activity's notification SHALL use the user's own label verbatim.
3. An activity MAY have an end reminder, which SHALL be off by default and settable per activity.
4. WHEN an end reminder is enabled THEN the system SHALL queue it for the start time plus the duration, and SHALL cancel it
   if the start notification's occurrence is cancelled.
5. Notifications SHALL be delivered by the existing sender over Web Push, reusing the existing claiming, staleness and
   subscription handling without modification to those parts.
6. A notification SHALL carry a tag that replaces rather than stacks a previous notification for the same activity, so a
   phone left unattended does not accumulate a column of identical reminders.
7. A water reminder's notification SHALL deep-link to the water logger so that logging a glass is one tap from the
   notification.
8. The system SHALL respect a single master switch for activity notifications, independent of the existing fasting
   notification preferences.

## Requirement 5: Recording that it happened

**User Story:** As someone building a habit, I want to mark an activity done, so that the app shows me what I actually did
rather than only what I intended.

### Acceptance Criteria

1. A user SHALL be able to record a completion for an activity, with the time it happened and its duration.
2. A completion SHALL be recordable without a preceding reminder, so an unplanned walk can be logged.
3. A completion SHALL record where it came from: recorded by hand, or imported from a third party. The second value SHALL
   exist in the schema from the start so that adding an integration later is not a migration of historical rows.
4. A user SHALL be able to delete a completion, and deleting one SHALL NOT affect the schedule that prompted it.
5. The system SHALL NOT require a completion. An ignored reminder SHALL leave no record and SHALL NOT be treated as a
   failure, because an app that scolds is an app that gets deleted.
6. WHEN the activity is water THEN recording a completion SHALL write a water entry through the existing water feature
   rather than duplicating it.

## Requirement 6: Seeing what you did

**User Story:** As a user, I want to see my activity history and a little encouragement, so that the reminders feel like
they are going somewhere.

### Acceptance Criteria

1. The system SHALL show a list of recent completions grouped by day, in the user's own time zone.
2. The system SHALL show, per activity, the count of completions in the last 7 and 30 days and the total time spent.
3. The system SHALL show a current streak of consecutive days with at least one completion, counted in the user's own time
   zone, using the same streak rules the fasting feature already uses.
4. Statistics SHALL be computed from completions only, never from reminders sent, so that the numbers describe what
   happened rather than what was suggested.
5. WHEN a user has no completions THEN the system SHALL say so plainly and point at adding an activity, rather than
   rendering empty charts.

## Requirement 7: Managing it all

**User Story:** As a user, I want one place to add, edit and silence activities, so that I can fix a schedule that is
annoying me in a few seconds.

### Acceptance Criteria

1. The system SHALL provide a screen listing the user's activities, each showing its type, duration, schedules in plain
   language, and whether it is enabled.
2. Schedules SHALL be described in words — "Every day at 07:00", "Weekdays every 2 hours, 08:00 to 20:00" — reusing the
   existing weekday-describing helper.
3. A user SHALL be able to disable an activity from the list in one action, without opening a detail view.
4. The system SHALL show the next scheduled occurrence for each enabled activity, so that a misconfigured schedule is
   visible before it misfires rather than after.
5. All forms SHALL validate before submitting and SHALL state what is wrong in words the user can act on.

## Requirement 8: Time zones and travel

**User Story:** As someone who travels, I want my reminders to follow local time, so that a 07:00 swim reminder does not
arrive at 03:00.

### Acceptance Criteria

1. All schedule times SHALL be stored as wall-clock times and resolved against the user's profile time zone at queue time,
   never stored as absolute instants.
2. WHEN a user changes their time zone THEN future occurrences SHALL follow the new zone, and already-queued pending
   notifications for the old zone SHALL be cancelled and requeued.
3. The system SHALL handle a daylight saving transition without queueing an occurrence twice or skipping one, and this
   SHALL be verified by a test against a real Postgres rather than reasoned about.

## Requirement 9: Offline and the installed app

**User Story:** As a user on a patchy connection, I want the activity screens to behave like the rest of the app, so that
nothing feels second class.

### Acceptance Criteria

1. Activity screens SHALL render from cache when offline and SHALL show the same offline banner the rest of the app uses.
2. Recording a completion while offline SHALL be queued and retried, consistent with how the app already handles writes.
3. Notification delivery SHALL remain entirely server-driven, so a reminder arrives whether or not the app is open.

## Requirement 10: Accessibility

**User Story:** As a user with assistive technology, I want the activity screens to be as usable as the rest of Fastr.

### Acceptance Criteria

1. Every activity control SHALL be reachable and operable by keyboard alone, with a visible focus indicator.
2. Activity type SHALL NOT be conveyed by icon or colour alone; each SHALL carry a text label.
3. The activity screens SHALL pass the project's axe checks with no violations, under the same configuration as the
   existing screens.
4. Every new colour pair SHALL meet WCAG 2.1 AA contrast, verified arithmetically by the existing contrast test.
5. Schedule forms SHALL use real labels associated with their controls, and hints SHALL be attached with
   `aria-describedby` rather than placed inside the label.

## Requirement 11: Unblocking the existing schema

**User Story:** As the maintainer, I want the constraints that prevent this feature removed deliberately and with their
reasoning recorded, so that nobody reinstates them.

### Acceptance Criteria

1. The `reminder_has_no_fast` CHECK constraint SHALL be replaced with one that requires a `fast_id` for fast-related kinds
   only, and permits activity kinds to carry an activity reference instead.
2. The `notifications` table SHALL gain a nullable reference to the activity schedule that produced a row, with a foreign
   key that cascades on delete.
3. A partial unique index SHALL prevent more than one pending or sent notification per schedule, kind and occurrence time.
4. The `kind` CHECK constraint SHALL be extended with `activity_start` and `activity_end`.
5. Every new table SHALL have Row Level Security enabled and owner-scoped policies in the same migration, so that
   `npm run check:rls` passes.
6. The reference table of activity types SHALL be world-readable like `fasting_stages`, because it is reference data and
   contains nothing about any user.
7. Migrations SHALL be additive and SHALL NOT require existing rows to be rewritten.

## Requirement 12: Not breaking what works

**User Story:** As the maintainer, I want confidence that adding this did not damage fasting, because fasting is the thing
people actually use.

### Acceptance Criteria

1. Existing fasting notifications SHALL continue to queue, claim, send and cancel exactly as before, verified by the
   existing tests passing unchanged.
2. The notification `kind` values SHALL be asserted identical across the SQL constraint, the shared TypeScript union, and
   the Edge Function's own union, by a test that reads all three. Today nothing checks this and the three can drift
   silently.
3. The sender's `compose` function SHALL handle every kind exhaustively, and a missing case SHALL be a type error rather
   than a notification with no text.
4. Row Level Security SHALL be proved for each new table against a real local Postgres, asserting that one user cannot
   read, write or delete another user's rows.
5. Every validation rule SHALL be expressed both in Zod and as a database constraint, with a parity test asserting that
   Postgres accepts and rejects exactly what Zod does, matching the existing convention.
6. The export payload SHALL include activities, schedules and completions, and import SHALL accept them in one transaction.
   An export taken before this feature SHALL still import successfully.

## Requirement 13: The fasting reminder stays where it is

**User Story:** As the maintainer, I want the decision not to merge the two reminder systems written down, so that the
duplication is understood as a choice rather than an oversight.

### Acceptance Criteria

1. The existing `reminders` table, its UI, and the `'reminder'` notification kind SHALL be left in place and working.
2. The duplication between the two systems SHALL be documented at both definitions, stating that it is deliberate and what
   it would cost to merge them.
3. The activity tables SHALL be shaped so the fasting reminder could later become an activity type, which means the schema
   SHALL NOT assume every activity is optional or that no activity relates to a fast.
4. The system SHALL NOT send both a fasting reminder and an activity reminder for the same moment without them being
   visually distinguishable.

## Requirement 14: Third-party integrations are out of scope, for stated reasons

**User Story:** As the maintainer, I want the Strava question answered in the spec, so that it is a decision rather than an
open loop.

### Acceptance Criteria

1. This spec SHALL NOT implement Strava or any other third-party integration.
2. The reasoning SHALL be recorded: Strava reports activities that have already happened and cannot drive a reminder, so it
   does not serve this feature's purpose. Its value would be closing the loop afterwards by recording a completion
   automatically.
3. The known costs SHALL be recorded: an OAuth client secret requiring a new Edge Function, the first table in the project
   holding third-party credentials with refresh handling, a webhook or polling path, and Strava's rate limits of 200
   requests per fifteen minutes and 2,000 per day **per application rather than per user**, which is a ceiling shared by
   every user of the deployment.
4. The schema SHALL be prepared for it, per Requirement 5.3, so that adding it later is additive.
5. A future integration SHALL honour Strava's API policy that a user's data may only be shown back to that same user, which
   the existing Row Level Security already enforces.
