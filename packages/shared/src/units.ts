import type { VolumeUnit, WeightUnit } from './types.js';

/**
 * Unit conversion. Requirement 11.2: weight is stored as grams and water as millilitres, and units
 * are a display concern only.
 *
 * Storing the canonical unit rather than the user's chosen one means switching from kg to lb
 * re-renders the same history instead of reinterpreting it, which is the bug this avoids.
 */

const GRAMS_PER_POUND = 453.59237;
const ML_PER_FL_OZ = 29.5735295625; // US fluid ounce

export function gramsToKg(grams: number): number {
  return grams / 1000;
}

export function kgToGrams(kg: number): number {
  return Math.round(kg * 1000);
}

export function gramsToLb(grams: number): number {
  return grams / GRAMS_PER_POUND;
}

export function lbToGrams(lb: number): number {
  return Math.round(lb * GRAMS_PER_POUND);
}

export function gramsToDisplay(grams: number, unit: WeightUnit): number {
  return unit === 'kg' ? gramsToKg(grams) : gramsToLb(grams);
}

export function displayToGrams(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? kgToGrams(value) : lbToGrams(value);
}

/** One decimal place. Two implies a precision that bathroom scales do not have. */
export function formatWeight(grams: number, unit: WeightUnit): string {
  return `${gramsToDisplay(grams, unit).toFixed(1)} ${unit}`;
}

export function mlToFlOz(ml: number): number {
  return ml / ML_PER_FL_OZ;
}

export function flOzToMl(flOz: number): number {
  return Math.round(flOz * ML_PER_FL_OZ);
}

export function formatVolume(ml: number, unit: VolumeUnit): string {
  if (unit === 'ml') {
    // Whole litres read better than four digits of millilitres once past a litre.
    return ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1)} L` : `${ml} ml`;
  }
  return `${mlToFlOz(ml).toFixed(0)} fl oz`;
}
