# Implementation Plan

Ordered so that each wave leaves the tree green. The database comes first because every later claim depends on its
constraints being real, and the three-runtime `kind` parity test comes early because it is what stops the rest of the
work drifting.

- [x] 1. Single-source the activity type list
  - Add `packages/shared/src/activities.ts` with `ACTIVITY_TYPES`: `walk`, `run`, `cycle`, `swim`, `stretch`, `strength`,
    `water`, each with key, label, icon, `defaultMinutes`, `unit` (`'minutes' | 'ml'`) and `sortOrder`
  - Export from the barrel; add `ActivityType`, `ActivityUnit` to `types.ts`
  - Write `scripts/gen-activities.mjs` on the `gen-stages.mjs` pattern, emitting the `activity_types` migration and
    `supabase/functions/_shared/activityTypes.ts`, both with the `GENERATED FILE` header
  - Add `gen:activities` to `package.json` and to the CI drift-check step
  - Unit tests: keys unique, sort orders unique, water is the only `ml` unit
  - _Requirements: 1.1, 1.2, 11.6_

- [x] 2. Create the three user tables
  - Migration with `activities`, `activity_schedules`, `activity_log` exactly as designed, including
    `activity_named_once`, `schedule_shape`, `external_id_needs_source` and the `activity_log_external` unique index
  - `before insert or update` trigger setting `activity_schedules.user_id` from the parent activity
  - `before insert` trigger enforcing the 20-activity limit with a readable message
  - `touch_updated_at` trigger on `activities`
  - RLS enabled with the four owner policies per table, in the same migration
  - Verify `npm run check:rls` passes
  - _Requirements: 1.5, 1.6, 1.7, 2.1, 2.3, 3.1, 3.2, 5.1, 5.3, 5.4, 11.5, 11.7_

- [x] 3. Unblock the `notifications` table
  - Drop `reminder_has_no_fast`; add `activity_id` and `activity_schedule_id` columns with cascading FKs
  - Extend the `kind` CHECK with `activity_start` and `activity_end`
  - Add the `notification_reference` CHECK so each kind carries exactly the reference it needs
  - Add the `notifications_unique_per_occurrence` partial unique index
  - Confirm existing fasting notification tests still pass unchanged
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 12.1_

- [x] 4. Prove the kinds agree across three runtimes
  - Add `activity_start` and `activity_end` to `NotificationKind` in `packages/shared/src/types.ts`
  - Write the parity test that parses the CHECK constraint out of the migrations, reads the shared union, reads the Edge
    Function's union, and asserts all three sets are equal
  - This test should fail right now against the Edge Function; fixing it is task 8
  - _Requirements: 12.2_

- [ ] 5. Derive occurrences in SQL
  - Add `activity_occurrences(from_at, to_at)` as designed, `stable security definer`, service-role execute only
  - Tests against real Postgres: an `at` schedule on matching and non-matching weekdays; an `every` schedule producing
    the expected count; the last occurrence never past `window_end`; two users in different zones from one call
  - A daylight-saving test asserting no occurrence is duplicated or skipped across a transition
  - _Requirements: 2.1, 2.2, 2.4, 3.3, 3.5, 8.1, 8.3_

- [ ] 6. Queue, and prove it is idempotent
  - Add `queue_due_activities()` with the five-minute look-back and twenty-minute lookahead
  - Add the `profiles.notify_activities` column, defaulting true, and honour it
  - Schedule `fastr-queue-activities` at `*/15 * * * *`, guarded like the existing jobs
  - Tests: calling it repeatedly does not grow the row count; an end notification appears only when `notify_end`; a past
    occurrence outside the look-back is not queued
  - _Requirements: 2.4, 2.5, 3.4, 3.6, 4.3, 4.4, 4.8_

- [ ] 7. Cancel on change
  - Triggers on `activities` and `activity_schedules` cancelling pending notifications on disable, delete, or a change to
    a field that moves the time
  - Trigger on `profiles` cancelling pending activity notifications when `time_zone` changes
  - Tests: disabling cancels pending and leaves sent; changing a time cancels then requeues on the next run
  - _Requirements: 8.2, 11.2_

- [x] 8. Teach the sender the two new kinds
  - Add the kinds to the Edge Function's union; add `compose` branches using the generated `activityTypes.ts`
  - Add the `never` exhaustiveness guard so a missing branch is a build error
  - Hydrate activity rows in the existing batch step, alongside the fasts query
  - Tags `activity-${activity_id}` / `activity-end-${activity_id}`; `url` of `/` for water, `/history` otherwise
  - Confirm task 4's parity test now passes
  - _Requirements: 4.1, 4.2, 4.5, 4.6, 4.7, 12.2, 12.3_
  - Also fix the pre-existing bug found while reading this file: the `sent_at` update applies to every claimed row
    including the stale ones just marked `skipped`

- [ ] 9. Validation, in both places
  - Zod schemas for activity, schedule and completion in `packages/shared/src/schemas.ts`, including the
    window-longer-than-interval rule and the exactly-one-of naming rule
  - Parity tests asserting Postgres accepts and rejects exactly what Zod does
  - _Requirements: 12.5_

- [ ] 10. Prove RLS on the new tables
  - Extend `supabase/tests/rls.test.ts`: for each new table, user B cannot select, insert, update or delete user A's rows
  - Assert a client cannot insert a notification directly, and cannot forge `user_id` on a schedule
  - Assert `activity_types` is readable by any signed-in user
  - _Requirements: 12.4, 11.6_

- [ ] 11. Data layer
  - `data/activities.ts`: list with schedules, create, update, delete, toggle
  - `data/activityLog.ts`: record and delete a completion; a water completion writes through the existing water layer
  - Add `activities` and `activity_schedules` to the realtime publication with `replica identity full`
  - Move `describeWeekdays()` into `packages/shared` and point both reminder systems at the one copy
  - _Requirements: 5.6, 9.2_

- [ ] 12. Next-occurrence in TypeScript, agreeing with SQL
  - `nextOccurrence(schedule, now, timeZone)` in `packages/shared`
  - A test driving the same fixtures through both the TypeScript and the SQL function and asserting identical answers,
    because this duplication is the design's one accepted redundancy
  - _Requirements: 7.4_

- [ ] 13. The activities screen
  - `routes/Activities.tsx` as a sixth tab: list with type, duration, schedules in words, next occurrence, one-tap disable
  - `ActivityForm` with the preset picker plus "something else", duration, end-reminder toggle
  - `ScheduleFields` for the two shapes, showing the resulting notifications-per-day count for an interval schedule
  - Empty state pointing at adding the first activity
  - Measure at 320, 375, 390 and 768px; confirm six tabs and no horizontal overflow
  - _Requirements: 1.3, 1.4, 7.1, 7.2, 7.3, 7.5, 6.5_

- [ ] 14. Recording completions
  - A log control on the activities screen and on the timer screen
  - Water routes to the existing water logger rather than `activity_log`
  - Deleting a completion
  - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

- [ ] 15. Activity history and stats
  - Completions grouped by local day
  - Per-activity counts for 7 and 30 days, and total minutes
  - Current streak reusing the existing streak helper
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 16. Settings
  - The `notify_activities` master toggle alongside the existing notification toggles
  - Document at both reminder definitions that the duplication with the fasting reminder is deliberate, and what merging
    would cost
  - _Requirements: 4.8, 13.1, 13.2_

- [ ] 17. Export and import
  - Add activities, schedules and completions to the export payload and the import schema
  - Assert an export taken before this feature still imports
  - _Requirements: 12.6_

- [ ] 18. Accessibility pass
  - axe on the activities screen, the form, and the log control
  - Keyboard-only walk of the new screens
  - Confirm no activity type is distinguished by icon or colour alone
  - Contrast test covers any new pair
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 19. Offline behaviour
  - Activity screens render from cache offline and show the standard banner
  - A completion recorded offline is retried
  - _Requirements: 9.1, 9.2, 9.3_

- [ ] 20. Documentation, and the deferral written down
  - README: what the feature does, the two schedule shapes, the cron cadence change
  - Record the Strava decision and its costs where a future reader will find it, per Requirement 14
  - Confirm `npm run verify` green, then deploy the migrations and the function
  - _Requirements: 13.2, 14.1, 14.2, 14.3, 14.4, 14.5_
