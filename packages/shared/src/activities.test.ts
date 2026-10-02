import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_TYPES,
  activityIcon,
  activityLabel,
  findActivityType,
  isVolumeActivity,
} from './activities.js';

/**
 * The preset list, and the three helpers every screen uses to render one.
 *
 * Most of these assert properties the generator depends on rather than the contents of the list. A duplicate key
 * becomes a primary key violation in the generated migration, and a duplicate sort order becomes a unique index
 * violation — both at `db reset` time, in SQL, with nothing pointing back at the TypeScript that caused it.
 */

describe('the preset activity list (Req 1.1)', () => {
  it('has the seven v1 types', () => {
    expect(ACTIVITY_TYPES.map((type) => type.key)).toEqual([
      'walk',
      'run',
      'cycle',
      'swim',
      'stretch',
      'strength',
      'water',
    ]);
  });

  it('keeps keys unique', () => {
    // `key` is the primary key of the generated table. A duplicate here fails `db reset`.
    const keys = ACTIVITY_TYPES.map((type) => type.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps sort orders unique', () => {
    // The generated column carries a unique constraint, so a duplicate is a migration failure rather
    // than two activities quietly sharing a position.
    const orders = ACTIVITY_TYPES.map((type) => type.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('is already in sort order, so no screen has to sort it', () => {
    const orders = ACTIVITY_TYPES.map((type) => type.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('keeps every default duration inside what the column allows', () => {
    // `check (default_minutes between 1 and 480)` in the generated migration.
    for (const type of ACTIVITY_TYPES) {
      expect(type.defaultMinutes, type.key).toBeGreaterThanOrEqual(1);
      expect(type.defaultMinutes, type.key).toBeLessThanOrEqual(480);
    }
  });

  it('gives every type a label and an icon', () => {
    // Requirement 10.2 forbids conveying the type by icon alone, so the label is not optional.
    for (const type of ACTIVITY_TYPES) {
      expect(type.label.trim(), type.key).not.toBe('');
      expect(type.icon.trim(), type.key).not.toBe('');
    }
  });

  it('makes water the only volume activity', () => {
    // The `ml` unit is what routes a completion to water_entries instead of activity_log
    // (Requirement 5.6). A second volume type would need that routing generalised first.
    const volume = ACTIVITY_TYPES.filter((type) => type.unit === 'ml');
    expect(volume.map((type) => type.key)).toEqual(['water']);
  });
});

describe('finding a type', () => {
  it('finds a preset by key', () => {
    expect(findActivityType('swim')?.label).toBe('Swim');
  });

  it('returns undefined for a custom activity, which has no type', () => {
    // Null is the real stored value for a custom activity, so it is the case that matters.
    expect(findActivityType(null)).toBeUndefined();
    expect(findActivityType(undefined)).toBeUndefined();
    expect(findActivityType('')).toBeUndefined();
    expect(findActivityType('not-a-type')).toBeUndefined();
  });
});

describe('naming an activity (Req 1.4)', () => {
  it('uses the preset label when there is a type', () => {
    expect(activityLabel('swim', null)).toBe('Swim');
  });

  it('prefers the preset over a stray custom label', () => {
    // The schema forbids both being set, so this only happens to data that got in another way.
    // Preferring the preset keeps the displayed name consistent with the icon beside it.
    expect(activityLabel('swim', 'Something else')).toBe('Swim');
  });

  it('uses the custom label when there is no type', () => {
    expect(activityLabel(null, 'Physio')).toBe('Physio');
  });

  it('trims a custom label, because a leading space is invisible in a notification', () => {
    expect(activityLabel(null, '  Physio  ')).toBe('Physio');
  });

  it('falls back to a word rather than rendering "undefined"', () => {
    // Unreachable through the app: the schema guarantees one of the two. A history list that renders
    // "Activity" is a far better failure than one that crashes or shows "undefined".
    expect(activityLabel(null, null)).toBe('Activity');
    expect(activityLabel(null, '   ')).toBe('Activity');
  });
});

describe('icons', () => {
  it('uses the type icon for a preset', () => {
    expect(activityIcon('water')).toBe('💧');
  });

  it('uses a generic icon for a custom activity', () => {
    expect(activityIcon(null)).toBe('⭐');
  });
});

describe('volume activities', () => {
  it('is true for water and false for the rest', () => {
    expect(isVolumeActivity('water')).toBe(true);
    expect(isVolumeActivity('swim')).toBe(false);
    expect(isVolumeActivity(null)).toBe(false);
  });
});
