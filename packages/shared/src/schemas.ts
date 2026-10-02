import { z } from 'zod';
import { CUSTOM_STEP_MINUTES, MAX_GOAL_MINUTES, MIN_GOAL_MINUTES, PLANS } from './plans.js';
import { ACTIVITY_TYPES } from './activities.js';

/**
 * Zod schemas for every write the app performs. Requirement 18.6.
 *
 * These are deliberately the *second* line of defence, not the only one. Anyone can take the
 * published anon key, mint their own JWT by signing in, and POST straight to the REST endpoint
 * without going near this file, so every rule here that actually matters also exists as a Postgres
 * constraint. The job of these schemas is a good error message before a request leaves the browser,
 * and types the app compiles against.
 *
 * Where a bound appears in both places, the parity test in `supabase/tests` asserts Postgres accepts
 * and rejects exactly the same values, so tightening one and forgetting the other fails the build.
 */

/** Grams. Requirement 11.4: 20 kg to 400 kg. */
export const MIN_WEIGHT_GRAMS = 20_000;
export const MAX_WEIGHT_GRAMS = 400_000;

/** Requirement 13.1. */
export const MAX_NOTE_LENGTH = 1000;

/** Requirement 5.3. A start may be backdated this far and no further. */
export const MAX_BACKDATE_HOURS = 48;

const planIds = PLANS.map((plan) => plan.id) as [string, ...string[]];

export const instantSchema = z.iso.datetime({ offset: true });
export const localDateSchema = z.iso.date();

/**
 * An IANA zone name, checked against the runtime's own list rather than by pattern. A regex would
 * accept `Africa/Nairobbi`, which then fails much later and much less clearly.
 *
 * Membership, not a `try`/`catch` around `Intl.DateTimeFormat`: that constructor also accepts a
 * fixed offset like `+03:00`, and an offset cannot survive a daylight saving change, which is
 * exactly what the reminder scheduling in Requirement 8.4 depends on.
 */
const zoneNames: ReadonlySet<string> = new Set(
  // Guarded because `supportedValuesOf` is absent on older runtimes; the fallback keeps the two
  // names the app itself can produce working rather than rejecting everything.
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'],
);

export const timeZoneSchema = z
  .string()
  .refine((value) => value === 'UTC' || zoneNames.has(value), {
    message: 'Not a recognised time zone name.',
  });

export const goalMinutesSchema = z
  .number()
  .int()
  .min(MIN_GOAL_MINUTES, 'A fast must be at least one hour.')
  .max(MAX_GOAL_MINUTES, 'A fast cannot be longer than 72 hours.');

export const customGoalMinutesSchema = goalMinutesSchema.refine(
  (minutes) => minutes % CUSTOM_STEP_MINUTES === 0,
  { message: 'Choose a length in fifteen-minute steps.' },
);

const moodSchema = z.number().int().min(1).max(5);
const noteSchema = z.string().max(MAX_NOTE_LENGTH);

export const startFastSchema = z.object({
  planId: z.enum(planIds),
  goalMinutes: goalMinutesSchema,
  /** Omitted means now. Present means a backdated start, which the server bounds again. */
  startAt: instantSchema.optional(),
});

export const endFastSchema = z.object({
  id: z.uuid(),
  endedAt: instantSchema.optional(),
  mood: moodSchema.nullable().optional(),
  energy: moodSchema.nullable().optional(),
  note: noteSchema.nullable().optional(),
});

/**
 * Editing a fast. Requirement 5.9's ordering rule is checked here for a readable message and again
 * by the database, which is what makes it true.
 */
export const editFastSchema = z
  .object({
    id: z.uuid(),
    startAt: instantSchema,
    endedAt: instantSchema.nullable(),
    goalMinutes: goalMinutesSchema,
    mood: moodSchema.nullable().optional(),
    energy: moodSchema.nullable().optional(),
    note: noteSchema.nullable().optional(),
  })
  .refine((fast) => fast.endedAt === null || Date.parse(fast.endedAt) > Date.parse(fast.startAt), {
    message: 'A fast cannot end before it started.',
    path: ['endedAt'],
  });

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  timeZone: timeZoneSchema.optional(),
  weightUnit: z.enum(['kg', 'lb']).optional(),
  volumeUnit: z.enum(['ml', 'floz']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  defaultPlanId: z.enum(planIds).optional(),
  customGoalMinutes: customGoalMinutesSchema.nullable().optional(),
  waterGoalMl: z.number().int().min(100).max(10_000).optional(),
  notifyGoal: z.boolean().optional(),
  notifyStages: z.boolean().optional(),
  notifyHourBefore: z.boolean().optional(),
});

export const weightEntrySchema = z.object({
  measuredOn: localDateSchema,
  grams: z
    .number()
    .int()
    .min(MIN_WEIGHT_GRAMS, 'That weight looks too low to be right.')
    .max(MAX_WEIGHT_GRAMS, 'That weight looks too high to be right.'),
});

export const waterEntrySchema = z.object({
  ml: z.number().int().min(1).max(5000),
  loggedAt: instantSchema.optional(),
});

export const dayNoteSchema = z.object({
  day: localDateSchema,
  mood: moodSchema.nullable().optional(),
  energy: moodSchema.nullable().optional(),
  note: noteSchema.nullable().optional(),
});

export const reminderSchema = z.object({
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 20:00.'),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day.').max(7),
  enabled: z.boolean(),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(500).optional(),
});

/* -------------------------------------------------------------------------- */
/* Activities                                                                 */
/* -------------------------------------------------------------------------- */

export const MIN_ACTIVITY_MINUTES = 1;
export const MAX_ACTIVITY_MINUTES = 480;
export const MIN_ACTIVITY_INTERVAL_MINUTES = 15;
export const MAX_ACTIVITY_INTERVAL_MINUTES = 720;
export const MAX_ACTIVITIES = 20;

const activityTypeKeys = ACTIVITY_TYPES.map((type) => type.key) as [string, ...string[]];

/** `HH:MM`, the same shape the reminders table uses. */
const wallClockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 07:00.');

const weekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1, 'Pick at least one day.')
  .max(7);

/** Minutes since midnight, for comparing two `HH:MM` strings without parsing dates. */
function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours! * 60 + minutes!;
}

/**
 * An activity, named exactly once.
 *
 * The `superRefine` mirrors the `activity_named_once` CHECK constraint. Both exist on purpose: this one
 * produces a message a user can act on, and the constraint is the one that is actually true — a client is not
 * the only thing that can write to this table.
 */
export const activitySchema = z
  .object({
    typeKey: z.enum(activityTypeKeys).nullable(),
    customLabel: z.string().trim().min(1).max(40).nullable(),
    durationMinutes: z.number().int().min(MIN_ACTIVITY_MINUTES).max(MAX_ACTIVITY_MINUTES),
    notifyEnd: z.boolean(),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const hasType = value.typeKey !== null;
    const hasLabel = value.customLabel !== null && value.customLabel.trim().length > 0;

    if (hasType && hasLabel) {
      ctx.addIssue({
        code: 'custom',
        path: ['customLabel'],
        message: 'Choose a preset or give your own name, not both.',
      });
    }
    if (!hasType && !hasLabel) {
      ctx.addIssue({
        code: 'custom',
        path: ['typeKey'],
        message: 'Pick an activity, or give your own name.',
      });
    }
  });

/**
 * A schedule, in one of two shapes.
 *
 * A discriminated union rather than one object with everything optional, so the type itself refuses the
 * nonsense combinations — a `kind: 'at'` with an interval is not a validation failure, it is unrepresentable.
 * That mirrors the `schedule_shape` CHECK, which does the same job for anything that reaches the database by
 * another route.
 */
export const activityScheduleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('at'),
    localTime: wallClockSchema,
    weekdays: weekdaysSchema,
    enabled: z.boolean(),
    /*
     * The other shape's fields, explicitly forbidden rather than merely absent.
     *
     * Zod strips unknown keys by default, so without these an `at` schedule carrying `intervalMinutes`
     * parsed cleanly — and then Postgres refused it on `schedule_shape`, which is precisely the drift the
     * parity test exists to catch. It did.
     *
     * `z.undefined()` rather than `.strict()`: it mirrors the CHECK constraint exactly, forbidding the
     * three fields that conflict while leaving the schema tolerant of unrelated keys, which matters because
     * this same schema validates imported files.
     */
    windowStart: z.undefined().optional(),
    windowEnd: z.undefined().optional(),
    intervalMinutes: z.undefined().optional(),
  }),
  z
    .object({
      kind: z.literal('every'),
      windowStart: wallClockSchema,
      windowEnd: wallClockSchema,
      localTime: z.undefined().optional(),
      intervalMinutes: z
        .number()
        .int()
        .min(MIN_ACTIVITY_INTERVAL_MINUTES)
        .max(MAX_ACTIVITY_INTERVAL_MINUTES),
      weekdays: weekdaysSchema,
      enabled: z.boolean(),
    })
    .superRefine((value, ctx) => {
      const span = minutesOfDay(value.windowEnd) - minutesOfDay(value.windowStart);

      if (span <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['windowEnd'],
          message: 'The end time has to be after the start time.',
        });
        return;
      }

      // Requirement 3.2. A window shorter than its interval fires once, which is not what "every two
      // hours" means. Refused rather than silently degraded into a single daily reminder.
      if (span < value.intervalMinutes) {
        ctx.addIssue({
          code: 'custom',
          path: ['intervalMinutes'],
          message: 'The window is shorter than the interval, so this would only ever fire once.',
        });
      }
    }),
]);

/** A recorded completion. */
export const activityLogSchema = z.object({
  label: z.string().trim().min(1).max(40),
  typeKey: z.enum(activityTypeKeys).nullable(),
  occurredAt: instantSchema,
  // Nullable: an unplanned walk logged after the fact may have no duration worth claiming, and a required
  // number would be invented. 1440 is a day, past which this is a typing error rather than a duration.
  minutes: z.number().int().min(1).max(1440).nullable(),
  note: z.string().max(280).nullable(),
});

/** The shape of a Fastr export, and therefore of an import. Requirement 16.2 and 16.3. */
export const exportSchema = z.object({
  version: z.literal(1),
  exportedAt: instantSchema,
  profile: profileUpdateSchema,
  fasts: z.array(
    z.object({
      planId: z.string(),
      goalMinutes: goalMinutesSchema,
      startAt: instantSchema,
      endedAt: instantSchema.nullable(),
      status: z.enum(['active', 'completed', 'ended_early']),
      mood: moodSchema.nullable(),
      energy: moodSchema.nullable(),
      note: noteSchema.nullable(),
    }),
  ),
  weightEntries: z.array(weightEntrySchema),
  waterEntries: z.array(z.object({ loggedAt: instantSchema, ml: z.number().int() })),
  dayNotes: z.array(dayNoteSchema),
  reminders: z.array(reminderSchema),

  /*
   * Optional, and that is Requirement 12.6: an export taken before activities existed has no such keys, and
   * it must still import. Defaulting to an empty array rather than making them required means an old file
   * round-trips without the import function special-casing a version.
   */
  activities: z
    .array(
      z.object({
        typeKey: z.string().nullable(),
        customLabel: z.string().nullable(),
        durationMinutes: z.number().int(),
        notifyEnd: z.boolean(),
        enabled: z.boolean(),
        schedules: z.array(activityScheduleSchema).default([]),
      }),
    )
    .default([]),
  activityLog: z.array(activityLogSchema).default([]),
});

export type StartFastInput = z.infer<typeof startFastSchema>;
export type EndFastInput = z.infer<typeof endFastSchema>;
export type EditFastInput = z.infer<typeof editFastSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type WeightEntryInput = z.infer<typeof weightEntrySchema>;
export type WaterEntryInput = z.infer<typeof waterEntrySchema>;
export type DayNoteInput = z.infer<typeof dayNoteSchema>;
export type ReminderInput = z.infer<typeof reminderSchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
export type ActivityInput = z.infer<typeof activitySchema>;
export type ActivityScheduleInput = z.infer<typeof activityScheduleSchema>;
export type ActivityLogInput = z.infer<typeof activityLogSchema>;
export type FastrExport = z.infer<typeof exportSchema>;
