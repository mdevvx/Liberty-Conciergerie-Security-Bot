// src/config/constants.js
// ─────────────────────────────────────────────────────────────────────────────
// App-wide constants. Centralised here so a single change propagates everywhere.
// ─────────────────────────────────────────────────────────────────────────────

// ── Embed colours (hex) ───────────────────────────────────────────────────────
export const COLORS = {
  SUCCESS: 0x2ecc71,   // Green
  ERROR: 0xe74c3c,     // Red
  WARNING: 0xf39c12,   // Orange
  INFO: 0x3498db,      // Blue
  NEUTRAL: 0x95a5a6,   // Grey
  SHADOW: 0x2c2f33,    // Dark — used for shadow/mod queue embeds
};

// ── Emojis ────────────────────────────────────────────────────────────────────
export const EMOJI = {
  SUCCESS: '✅',
  ERROR: '❌',
  WARNING: '⚠️',
  INFO: 'ℹ️',
  SHADOW: '👁️',
  APPROVE: '✅',
  REJECT: '🚫',
  RELEASE: '🔓',
  STATUS: '📊',
  TOGGLE_ON: '🟢',
  TOGGLE_OFF: '🔴',
  LOADING: '⏳',
  MOD: '🛡️',
  BOT: '🤖',
};

// ── Classification results ────────────────────────────────────────────────────
export const CLASSIFICATION = {
  SAFE: 'SAFE',
  SUSPECT: 'SUSPECT',
  TOXIC: 'TOXIC',
};

// ── Shadow message status ─────────────────────────────────────────────────────
export const SHADOW_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  RELEASED: 'released',
};

// ── Timing ────────────────────────────────────────────────────────────────────
export const TIMING = {
  DELETE_WINDOW_MS: 250,   // Target delete within 250ms to avoid Discord "deleted" notice
};

// ── Discord permission bit fields needed by the bot ──────────────────────────
export const REQUIRED_PERMISSIONS = [
  'ManageMessages',
  'ManageRoles',
  'ManageWebhooks',
  'ReadMessageHistory',
  'SendMessages',
  'ViewChannel',
];
