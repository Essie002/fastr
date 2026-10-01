// GENERATED FILE — do not edit by hand.
//
// Written by `npm run gen:stages` from packages/shared/src/stages.ts, which is the source of truth. Edge
// Functions cannot import from packages/shared, because `functions deploy` bundles only the function's own
// directory. CI regenerates this and fails if it differs.

export interface FastingStage {
  key: string;
  atMinutes: number;
  name: string;
  description: string;
}

export const STAGES: readonly FastingStage[] = [
  {
    "key": "blood_sugar_rising",
    "atMinutes": 0,
    "name": "Blood sugar rising",
    "description": "Your last meal is still being digested and blood sugar is up. The body is running on what you just ate."
  },
  {
    "key": "blood_sugar_falling",
    "atMinutes": 120,
    "name": "Blood sugar falling",
    "description": "Digestion is finishing and blood sugar typically starts to come back down. Insulin usually falls with it."
  },
  {
    "key": "blood_sugar_normal",
    "atMinutes": 300,
    "name": "Blood sugar normal",
    "description": "Blood sugar is generally back to its baseline. The body is drawing on glycogen stored in the liver for energy."
  },
  {
    "key": "fat_burning",
    "atMinutes": 720,
    "name": "Fat burning begins",
    "description": "Liver glycogen is often running low by around this point, and the body typically turns more to stored fat for fuel."
  },
  {
    "key": "ketosis",
    "atMinutes": 1080,
    "name": "Ketosis",
    "description": "The liver may start producing ketones from fat in useful amounts. How quickly this happens varies a lot between people."
  },
  {
    "key": "autophagy",
    "atMinutes": 1440,
    "name": "Autophagy",
    "description": "Cellular clean-up, where cells recycle worn-out parts, is thought to increase around this point. Most of the evidence comes from animal studies, so treat the timing loosely."
  },
  {
    "key": "growth_hormone",
    "atMinutes": 2880,
    "name": "Growth hormone rising",
    "description": "Growth hormone has been measured rising substantially in fasts of around this length, though the studies are small. This is deep into extended-fast territory."
  },
  {
    "key": "immune_reset",
    "atMinutes": 4320,
    "name": "Immune reset",
    "description": "Some research points to immune cell renewal around three days. A fast this long is not something to attempt without medical supervision."
  }
];
