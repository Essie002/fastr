// GENERATED FILE — do not edit by hand.
//
// Written by `npm run gen:stages` from packages/shared/src/plans.ts, which is the source of truth. Edge
// Functions cannot import from packages/shared, because `functions deploy` bundles only the function's own
// directory. CI regenerates this and fails if it differs.

export interface FastingPlan {
  id: string;
  label: string;
  fastMinutes: number;
  eatMinutes: number;
  difficulty: string;
  description: string;
  extended: boolean;
  custom: boolean;
}

export const PLANS: readonly FastingPlan[] = [
  {
    "id": "12:12",
    "label": "12:12",
    "fastMinutes": 720,
    "difficulty": "beginner",
    "description": "Eat within a twelve-hour window and fast for the other twelve. For most people this is a late breakfast and an early dinner, so it is the gentlest place to start.",
    "eatMinutes": 720,
    "extended": false,
    "custom": false
  },
  {
    "id": "14:10",
    "label": "14:10",
    "fastMinutes": 840,
    "difficulty": "beginner",
    "description": "A ten-hour eating window. A step up from 12:12 that usually only means skipping a late-night snack.",
    "eatMinutes": 600,
    "extended": false,
    "custom": false
  },
  {
    "id": "16:8",
    "label": "16:8",
    "fastMinutes": 960,
    "difficulty": "intermediate",
    "description": "The most common plan. Fast for sixteen hours and eat across eight, which in practice means skipping breakfast and eating between midday and eight in the evening.",
    "eatMinutes": 480,
    "extended": false,
    "custom": false
  },
  {
    "id": "18:6",
    "label": "18:6",
    "fastMinutes": 1080,
    "difficulty": "intermediate",
    "description": "A six-hour eating window, so usually two meals rather than three. Harder to fit around a normal working day than 16:8.",
    "eatMinutes": 360,
    "extended": false,
    "custom": false
  },
  {
    "id": "20:4",
    "label": "20:4",
    "fastMinutes": 1200,
    "difficulty": "advanced",
    "description": "Four hours to eat, sometimes called the warrior fast. One large meal and perhaps a snack.",
    "eatMinutes": 240,
    "extended": false,
    "custom": false
  },
  {
    "id": "23:1",
    "label": "OMAD",
    "fastMinutes": 1380,
    "difficulty": "advanced",
    "description": "One meal a day, inside a single hour. Everything you eat has to fit in that hour, which takes planning.",
    "eatMinutes": 60,
    "extended": false,
    "custom": false
  },
  {
    "id": "24h",
    "label": "24 hours",
    "fastMinutes": 1440,
    "difficulty": "advanced",
    "description": "A full day, usually dinner to dinner. Long enough to count as an extended fast, so read the notice first.",
    "eatMinutes": 0,
    "extended": true,
    "custom": false
  },
  {
    "id": "36h",
    "label": "36 hours",
    "fastMinutes": 2160,
    "difficulty": "advanced",
    "description": "A day and a half, covering a whole night and the day either side of it. Not a place to begin.",
    "eatMinutes": -720,
    "extended": true,
    "custom": false
  },
  {
    "id": "custom",
    "label": "Custom",
    "fastMinutes": 960,
    "difficulty": "intermediate",
    "description": "Choose your own length, anywhere from one to seventy-two hours, in fifteen-minute steps.",
    "eatMinutes": 480,
    "extended": false,
    "custom": true
  }
];
