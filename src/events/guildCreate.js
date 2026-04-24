// src/events/guildCreate.js
// ─────────────────────────────────────────────────────────────────────────────
// Fires when the bot is added to a new server.
// Logs the event — guild settings are created lazily on first use.
// ─────────────────────────────────────────────────────────────────────────────

import logger from '../utils/logger.js';

export const name = 'guildCreate';
export const once = false;

export async function execute(guild) {
  logger.info(`➕ Joined new guild: ${guild.name} (${guild.id}) | Members: ${guild.memberCount}`);
}
