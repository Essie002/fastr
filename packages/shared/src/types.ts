/**
 * Domain types, shared by the web app and the Edge Functions.
 *
 * Two conventions run through this file.
 *
 * **Instants are ISO 8601 strings, not `Date` objects.** These types cross a JSON boundary in both
 * directions, and a `Date` does not survive that: it arrives as a string and any code that assumed
 * otherwise fails at the first `.getTime()`. Conversion happens at the edge of the app, once.
 *
 * **Durations are minutes.** Requirement 4.5 asks for 15-minute steps and Requirement 17.3 caps a
 * fast at 72 hours, so minutes express every value exactly with no fractions and no unit ambiguity
 * in a field name like `goal`.
 */

/** ISO 8601 instant with a zone, e.g. `2026-09-30T18:00:00.000Z`. Always UTC from the database. */
export type Instant = string;

/** Calendar date with no time and no zone, e.g. `2026-09-30`. A local day, never an instant. */
export type LocalDate = string;

/** IANA time zone name, e.g. `Africa/Nairobi`. Never an offset: offsets cannot survive DST. */
export type TimeZone = string;

export type PlanId = string;

export interface FastingPlan {
  id: PlanId;
  label: string;
  fastMinutes: number;
  eatMinutes: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  description: string;
  /** 24 hours or more. Triggers the extended-fast notice, Requirement 4.3 and 17.2. */
  extended: boolean;
  /** The one plan whose length the user supplies. Requirement 4.5. */
  custom: boolean;
}

export interface FastingStage {
  key: string;
  atMinutes: number;
  name: string;
  description: string;
}

/**
 * How a completion of an activity is measured.
 *
 * `minutes` for anything you spend time on. `ml` exists for water alone, whose completions are volumes and are
 * written to `water_entries` rather than `activity_log` (Requirement 5.6).
 */
export type ActivityUnit = 'minutes' | 'ml';

/** A preset activity type. Generated into SQL and into the Edge Functions; see `activities.ts`. */
export interface ActivityType {
  key: string;
  label: string;
  icon: string;
  defaultMinutes: number;
  unit: ActivityUnit;
  sortOrder: number;
}

export type FastStatus = 'active' | 'completed' | 'ended_early';

export interface Fast {
  id: string;
  userId: string;
  planId: PlanId;
  goalMinutes: number;
  startAt: Instant;
  /** Null exactly when `status` is `active`. Enforced by a check constraint. */
  endedAt: Instant | null;
  status: FastStatus;
  mood: number | null;
  energy: number | null;
  note: string | null;
}

/** A fast known to have finished. Narrows away the null end, so callers stop checking for it. */
export interface CompletedFast extends Fast {
  endedAt: Instant;
  status: 'completed' | 'ended_early';
}

export type WeightUnit = 'kg' | 'lb';
export type VolumeUnit = 'ml' | 'floz';
export type Theme = 'light' | 'dark' | 'system';

export interface Profile {
  id: string;
  displayName: string;
  timeZone: TimeZone;
  weightUnit: WeightUnit;
  volumeUnit: VolumeUnit;
  theme: Theme;
  defaultPlanId: PlanId;
  /** Set only when `defaultPlanId` is the custom plan. */
  customGoalMinutes: number | null;
  waterGoalMl: number;
  notifyGoal: boolean;
  notifyStages: boolean;
  notifyHourBefore: boolean;
  /** When the health notice was acknowledged. Null means the app is still gated. Req 1.5. */
  healthNoticeAt: Instant | null;
}

export interface WeightEntry {
  id: string;
  userId: string;
  measuredOn: LocalDate;
  /** Canonical unit. Requirement 11.2: stored as grams, converted only for display. */
  grams: number;
}

export interface WaterEntry {
  id: string;
  userId: string;
  loggedAt: Instant;
  ml: number;
}

export interface DayNote {
  id: string;
  userId: string;
  day: LocalDate;
  mood: number | null;
  energy: number | null;
  note: string | null;
}

export interface Reminder {
  id: string;
  userId: string;
  /** Local wall-clock time, `HH:mm`. Resolved against the profile's zone at send time. */
  localTime: string;
  /** 0 is Sunday, matching Postgres `extract(dow)`. */
  weekdays: number[];
  enabled: boolean;
}

/**
 * What a queued notification is about.
 *
 * This union exists three times — here, as a CHECK constraint on `notifications.kind`, and as its own union
 * inside the send-notifications Edge Function, which cannot import this package. Nothing in the type system
 * connects them, and the two ways they drift are both silent: a kind missing from the SQL constraint is an
 * insert that fails at queue time, and a kind missing from the Edge Function is a notification delivered with
 * no text. `supabase/tests/notificationKinds.test.ts` reads all three and asserts they match.
 */
export type NotificationKind =
  'goal' | 'stage' | 'hour_before' | 'reminder' | 'activity_start' | 'activity_end';
export type NotificationStatus = 'pending' | 'sent' | 'skipped' | 'cancelled';

export interface QueuedNotification {
  id: string;
  userId: string;
  fastId: string | null;
  kind: NotificationKind;
  stageKey: string | null;
  dueAt: Instant;
  status: NotificationStatus;
}

export interface Stats {
  totalCompleted: number;
  averageMinutesLast7: number | null;
  averageMinutesLast30: number | null;
  longestMinutes: number | null;
  /** Fasts that met their goal, over all finished fasts. 0 to 1. Null when there are none. */
  goalCompletionRate: number | null;
}
