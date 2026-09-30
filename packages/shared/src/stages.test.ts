import { describe, expect, it } from 'vitest';
import {
  STAGES,
  findStage,
  minutesToNextStage,
  nextStage,
  stageAt,
  stagesWithin,
} from './stages.js';

describe('the stage list', () => {
  it('holds the eight stages the requirements name, in order, starting at zero', () => {
    // Requirement 6.1.
    expect(STAGES.map((stage) => [stage.key, stage.atMinutes])).toEqual([
      ['blood_sugar_rising', 0],
      ['blood_sugar_falling', 120],
      ['blood_sugar_normal', 300],
      ['fat_burning', 720],
      ['ketosis', 1080],
      ['autophagy', 1440],
      ['growth_hormone', 2880],
      ['immune_reset', 4320],
    ]);
  });

  it('is strictly increasing, which stageAt relies on to stop early', () => {
    for (let i = 1; i < STAGES.length; i += 1) {
      expect(STAGES[i]!.atMinutes).toBeGreaterThan(STAGES[i - 1]!.atMinutes);
    }
  });

  it('hedges every description', () => {
    // Requirement 6.5. Not a substitute for reading them, but it catches a flatly stated claim
    // being added later.
    const hedges = /typically|around|generally|often|may |thought to|varies|some |usually/i;
    for (const stage of STAGES) {
      if (stage.atMinutes === 0) continue; // the first describes the present, not a prediction
      expect(stage.description).toMatch(hedges);
    }
  });
});

describe('stageAt', () => {
  it('returns the last stage whose start has passed', () => {
    expect(stageAt(0).key).toBe('blood_sugar_rising');
    expect(stageAt(119).key).toBe('blood_sugar_rising');
    expect(stageAt(120).key).toBe('blood_sugar_falling');
    expect(stageAt(719).key).toBe('blood_sugar_normal');
    expect(stageAt(720).key).toBe('fat_burning');
  });

  it('stays on the last stage past the end of the list', () => {
    expect(stageAt(10_000).key).toBe('immune_reset');
  });

  it('treats a negative elapsed time as the first stage rather than throwing', () => {
    // A start time being edited backwards can briefly produce this, and breaking the timer over a
    // value the user is mid-way through fixing would be worse than absorbing it.
    expect(stageAt(-30).key).toBe('blood_sugar_rising');
  });
});

describe('nextStage and minutesToNextStage', () => {
  it('looks strictly forward, so standing exactly on a boundary advances', () => {
    expect(nextStage(0)?.key).toBe('blood_sugar_falling');
    expect(nextStage(120)?.key).toBe('blood_sugar_normal');
  });

  it('returns null at the final stage', () => {
    expect(nextStage(4320)).toBeNull();
    expect(minutesToNextStage(4320)).toBeNull();
  });

  it('counts down to the next boundary', () => {
    // Requirement 6.2.
    expect(minutesToNextStage(700)).toBe(20);
  });
});

describe('stagesWithin', () => {
  it('marks only boundaries inside the goal, and never the one at zero', () => {
    // Requirement 6.3. A marker at zero would sit on the ring's origin and say nothing.
    expect(stagesWithin(16 * 60).map((stage) => stage.key)).toEqual([
      'blood_sugar_falling',
      'blood_sugar_normal',
      'fat_burning',
    ]);
  });

  it('includes a boundary that lands exactly on the goal', () => {
    expect(stagesWithin(720).at(-1)?.key).toBe('fat_burning');
  });

  it('returns nothing for a fast shorter than the first boundary', () => {
    expect(stagesWithin(60)).toEqual([]);
  });
});

describe('findStage', () => {
  it('finds by key and returns undefined for an unknown one', () => {
    expect(findStage('ketosis')?.atMinutes).toBe(1080);
    expect(findStage('nope')).toBeUndefined();
  });
});
