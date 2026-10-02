import type { ActivityType } from './types.js';

/**
 * The preset activity types. Requirement 1.1.
 *
 * Single source of truth in three runtimes, the same arrangement the fasting stage list uses and for the same
 * reason: the web app imports this directly, `npm run gen:activities` writes it into a migration so Postgres can
 * hold a foreign key against it, and it writes a Deno copy because Edge Functions compose notification text from
 * the label and cannot import from this package. CI regenerates and fails if any copy has drifted.
 *
 * Presets exist so the notification can say "Time for a swim" rather than "Time for your activity", and so each
 * type can carry an icon. A custom activity gets neither; that is the stated price of not being a cage
 * (Requirement 1.4).
 *
 * Icons are emoji rather than an icon font or SVG set. They cost nothing, they render everywhere including inside
 * a push notification, and they survive a user's own text scaling. They are decorative in every case: Requirement
 * 10.2 forbids conveying the type by icon alone, so every surface shows the label too.
 */
export const ACTIVITY_TYPES: readonly ActivityType[] = [
  {
    key: 'walk',
    label: 'Walk',
    icon: '🚶',
    // Twenty minutes rather than an hour. The default should be the thing someone will actually do on a
    // Tuesday, because a default that feels like a commitment gets edited or abandoned.
    defaultMinutes: 20,
    unit: 'minutes',
    sortOrder: 1,
  },
  {
    key: 'run',
    label: 'Run',
    icon: '🏃',
    defaultMinutes: 30,
    unit: 'minutes',
    sortOrder: 2,
  },
  {
    key: 'cycle',
    label: 'Cycle',
    icon: '🚴',
    defaultMinutes: 45,
    unit: 'minutes',
    sortOrder: 3,
  },
  {
    key: 'swim',
    label: 'Swim',
    icon: '🏊',
    defaultMinutes: 45,
    unit: 'minutes',
    sortOrder: 4,
  },
  {
    key: 'stretch',
    label: 'Stretch',
    icon: '🧘',
    defaultMinutes: 10,
    unit: 'minutes',
    sortOrder: 5,
  },
  {
    key: 'strength',
    label: 'Strength',
    icon: '🏋️',
    defaultMinutes: 40,
    unit: 'minutes',
    sortOrder: 6,
  },
  {
    /*
     * Water is a preset like the others, not a special case bolted on elsewhere, so every screen can iterate
     * one list. What makes it behave differently is `unit`, and that difference is confined to two places: the
     * completion form asks for millilitres instead of minutes, and the completion is written to
     * `water_entries` through the existing water feature rather than to `activity_log` (Requirement 5.6).
     * Two records of how much someone drank would be a bug waiting to be found.
     *
     * `defaultMinutes` is still required by the type and is meaningless here. It is set to 1 rather than 0
     * because the column is constrained to a positive number, and a nullable column would push the special
     * case into the schema for the sake of one unused value.
     */
    key: 'water',
    label: 'Water',
    icon: '💧',
    defaultMinutes: 1,
    unit: 'ml',
    sortOrder: 7,
  },
];

/** Lookup by key. Undefined for a custom activity, which has no type. */
export function findActivityType(key: string | null | undefined): ActivityType | undefined {
  if (!key) return undefined;
  return ACTIVITY_TYPES.find((type) => type.key === key);
}

/**
 * What to call an activity, given its type and its custom label.
 *
 * One function rather than the same ternary in every component, because getting it wrong shows a user the word
 * "undefined" where the name of their own activity should be.
 */
export function activityLabel(
  typeKey: string | null | undefined,
  customLabel: string | null | undefined,
): string {
  const preset = findActivityType(typeKey);
  if (preset) return preset.label;
  const trimmed = customLabel?.trim();
  // The schema guarantees one of the two is present, so this is unreachable through the app. It returns a
  // word rather than throwing because a history row rendering as "Activity" is a far better outcome than a
  // crashed list.
  return trimmed && trimmed.length > 0 ? trimmed : 'Activity';
}

/** The icon for an activity. The generic one for custom, which has no type to look up. */
export function activityIcon(typeKey: string | null | undefined): string {
  return findActivityType(typeKey)?.icon ?? '⭐';
}

/** True when completions for this activity are volumes rather than durations. */
export function isVolumeActivity(typeKey: string | null | undefined): boolean {
  return findActivityType(typeKey)?.unit === 'ml';
}
