// src/events/guildCreate.js
// ─────────────────────────────────────────────────────────────────────────────
// Fires when the bot is added to a new server.
// Registers this guild's slash commands immediately so they appear without
// waiting for the next restart. Guild settings are still created lazily on
// first use.
// ─────────────────────────────────────────────────────────────────────────────

import { deployCommands } from '../utils/deployCommands.js';
import logger from '../utils/logger.js';

export const name = 'guildCreate';
export const once = false;

export async function execute(guild, client) {
  logger.info(`➕ Joined new guild: ${guild.name} (${guild.id}) | Members: ${guild.memberCount}`);

  try {
    await deployCommands(client, { guildId: guild.id });
  } catch (err) {
    logger.error('Command registration for new guild failed', {
      guildId: guild.id,
      error: err.message,
    });
  }
}
