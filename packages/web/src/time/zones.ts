/**
 * Time zones for the settings dropdown.
 *
 * `Intl.supportedValuesOf('timeZone')` returns well over four hundred names, which is an unusable select on
 * a phone. So the list is: the zone the profile already holds, the browser's own zone, and a short set of
 * common ones — deduplicated, and always including whatever is currently selected so a saved value can
 * never vanish from the control that edits it.
 *
 * A searchable combobox over the full list would be better and is a bigger component than this screen
 * needs today.
 */

const COMMON = [
  'UTC',
  'Africa/Nairobi',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Australia/Perth',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'America/Toronto',
  'Pacific/Auckland',
] as const;

export function detectedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** The current offset, so "Africa/Nairobi" reads as something a person can recognise. */
function offsetLabel(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

export function commonTimeZones(selected: string): { value: string; label: string }[] {
  const names = [...new Set([selected, detectedTimeZone(), ...COMMON])].filter(Boolean);

  return names.map((zone) => {
    const offset = offsetLabel(zone);
    // Underscores are an IANA spelling detail, not something to show a user.
    const readable = zone.replace(/_/g, ' ');
    return { value: zone, label: offset ? `${readable} (${offset})` : readable };
  });
}
