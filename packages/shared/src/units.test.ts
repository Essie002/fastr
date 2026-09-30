import { describe, expect, it } from 'vitest';
import {
  displayToGrams,
  flOzToMl,
  formatVolume,
  formatWeight,
  gramsToDisplay,
  gramsToKg,
  gramsToLb,
  kgToGrams,
  lbToGrams,
  mlToFlOz,
} from './units.js';

describe('weight conversion', () => {
  it('converts kg both ways', () => {
    expect(kgToGrams(72.5)).toBe(72_500);
    expect(gramsToKg(72_500)).toBe(72.5);
  });

  it('converts pounds both ways', () => {
    expect(lbToGrams(160)).toBe(72_575);
    expect(gramsToLb(72_575)).toBeCloseTo(160, 3);
  });

  it('round-trips through pounds within a gram', () => {
    // Requirement 11.2 stores grams, so a user working in pounds must not watch their weight drift
    // as they edit an entry.
    for (const lb of [120, 154.3, 199.9, 240]) {
      expect(gramsToLb(lbToGrams(lb))).toBeCloseTo(lb, 2);
    }
  });

  it('selects the unit for display', () => {
    expect(gramsToDisplay(72_500, 'kg')).toBe(72.5);
    expect(gramsToDisplay(72_575, 'lb')).toBeCloseTo(160, 3);
    expect(displayToGrams(72.5, 'kg')).toBe(72_500);
    expect(displayToGrams(160, 'lb')).toBe(72_575);
  });

  it('formats to one decimal place', () => {
    // Two would imply a precision bathroom scales do not have.
    expect(formatWeight(72_540, 'kg')).toBe('72.5 kg');
    expect(formatWeight(72_575, 'lb')).toBe('160.0 lb');
  });
});

describe('volume conversion', () => {
  it('converts fluid ounces both ways', () => {
    expect(flOzToMl(8)).toBe(237);
    expect(mlToFlOz(237)).toBeCloseTo(8.01, 1);
  });

  it('switches to litres past a litre', () => {
    expect(formatVolume(250, 'ml')).toBe('250 ml');
    expect(formatVolume(2000, 'ml')).toBe('2 L');
    expect(formatVolume(2250, 'ml')).toBe('2.3 L');
  });

  it('formats fluid ounces whole', () => {
    expect(formatVolume(2000, 'floz')).toBe('68 fl oz');
  });
});
