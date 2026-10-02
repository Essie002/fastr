// GENERATED FILE — do not edit by hand.
//
// Written by `npm run gen:activities` from packages/shared/src/activities.ts, which is the source of truth.
// Edge Functions cannot import from packages/shared, because `functions deploy` bundles only the function's
// own directory. CI regenerates this and fails if it differs.

export interface ActivityType {
  key: string;
  label: string;
  icon: string;
  defaultMinutes: number;
  unit: 'minutes' | 'ml';
  sortOrder: number;
}

export const ACTIVITY_TYPES: readonly ActivityType[] = [
  {
    "key": "walk",
    "label": "Walk",
    "icon": "🚶",
    "defaultMinutes": 20,
    "unit": "minutes",
    "sortOrder": 1
  },
  {
    "key": "run",
    "label": "Run",
    "icon": "🏃",
    "defaultMinutes": 30,
    "unit": "minutes",
    "sortOrder": 2
  },
  {
    "key": "cycle",
    "label": "Cycle",
    "icon": "🚴",
    "defaultMinutes": 45,
    "unit": "minutes",
    "sortOrder": 3
  },
  {
    "key": "swim",
    "label": "Swim",
    "icon": "🏊",
    "defaultMinutes": 45,
    "unit": "minutes",
    "sortOrder": 4
  },
  {
    "key": "stretch",
    "label": "Stretch",
    "icon": "🧘",
    "defaultMinutes": 10,
    "unit": "minutes",
    "sortOrder": 5
  },
  {
    "key": "strength",
    "label": "Strength",
    "icon": "🏋️",
    "defaultMinutes": 40,
    "unit": "minutes",
    "sortOrder": 6
  },
  {
    "key": "water",
    "label": "Water",
    "icon": "💧",
    "defaultMinutes": 1,
    "unit": "ml",
    "sortOrder": 7
  }
];

/** Lookup by key. Undefined for a custom activity, which has no type. */
export function findActivityType(key: string | null | undefined): ActivityType | undefined {
  if (!key) return undefined;
  return ACTIVITY_TYPES.find((type) => type.key === key);
}
