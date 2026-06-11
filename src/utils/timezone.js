// src/utils/timezone.js
// Timezone definitions and quiet-window logic for the silence filter.

export const TIMEZONES = [
  { label: 'UTC (UTC+0)',               value: 'UTC' },
  { label: 'EST — US Eastern (UTC-5)',  value: 'America/New_York' },
  { label: 'CST — US Central (UTC-6)',  value: 'America/Chicago' },
  { label: 'MST — US Mountain (UTC-7)', value: 'America/Denver' },
  { label: 'PST — US Pacific (UTC-8)',  value: 'America/Los_Angeles' },
  { label: 'GMT — London (UTC+0/+1)',   value: 'Europe/London' },
  { label: 'CET — Central Europe (UTC+1)', value: 'Europe/Paris' },
  { label: 'EET — Eastern Europe (UTC+2)', value: 'Europe/Helsinki' },
  { label: 'MSK — Moscow (UTC+3)',      value: 'Europe/Moscow' },
  { label: 'PKT — Pakistan (UTC+5)',    value: 'Asia/Karachi' },
  { label: 'IST — India (UTC+5:30)',    value: 'Asia/Kolkata' },
  { label: 'BST — Bangladesh (UTC+6)',  value: 'Asia/Dhaka' },
];

/**
 * Parse and validate a "HH:MM" 24-hour string.
 * Returns the normalised "HH:MM" string, or null if invalid.
 * @param {string} value
 * @returns {string|null}
 */
export function parseHHMM(value) {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? value.trim() : null;
}

/**
 * Check whether the current moment falls inside the configured quiet window.
 * Correctly handles overnight ranges (e.g. 19:00 → 09:00).
 *
 * @param {string} timezone   — IANA timezone name (e.g. "Europe/Paris")
 * @param {string} quietStart — "HH:MM" start of the quiet window
 * @param {string} quietEnd   — "HH:MM" end of the quiet window
 * @returns {boolean}
 */
export function isInQuietWindow(timezone, quietStart, quietEnd) {
  const now = new Date();

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const hour   = parseInt(parts.find((p) => p.type === 'hour')?.value   ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const current = hour * 60 + minute;

  const [sh, sm] = quietStart.split(':').map(Number);
  const [eh, em] = quietEnd.split(':').map(Number);
  const start = sh * 60 + sm;
  const end   = eh * 60 + em;

  if (start === end) return true; // same boundary = 24-hour window

  if (start < end) {
    // Same-day window: e.g. 09:00 – 17:00
    return current >= start && current < end;
  }

  // Overnight window: e.g. 19:00 – 09:00 (crosses midnight)
  return current >= start || current < end;
}
