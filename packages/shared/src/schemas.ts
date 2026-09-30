import { z } from 'zod';
import { CUSTOM_STEP_MINUTES, MAX_GOAL_MINUTES, MIN_GOAL_MINUTES, PLANS } from './plans.js';

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
export type FastrExport = z.infer<typeof exportSchema>;
