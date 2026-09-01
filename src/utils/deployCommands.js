// src/utils/deployCommands.js
// ─────────────────────────────────────────────────────────────────────────────
// Registers slash commands as GUILD commands for every guild the bot is in,
// and wipes the GLOBAL command set.
//
// Why guild-scoped instead of global:
//   • Commands only appear in servers where the bot is actually a member.
//     Global commands leak into every server that ever authorised the app's
//     `applications.commands` scope — even ones the bot never joined.
//   • Registration is instant (global takes up to 1 hour to propagate).
//   • Every deploy re-pushes the current payload, so Discord always has the
//     latest `default_member_permissions` — admin commands stay hidden from
//     normal members instead of showing a stale, ungated copy.
//
// When the bot is removed from a guild, Discord drops that guild's commands
// automatically — nothing to clean up here.
// ─────────────────────────────────────────────────────────────────────────────

import { REST, Routes } from 'discord.js';
import { config } from '../config/config.js';
import logger from './logger.js';

/**
 * Push the loaded slash commands to Discord.
 * @param {import('discord.js').Client} client Logged-in client with `commands` loaded
 * @param {{ guildId?: string }} [opts] Restrict the push to a single guild (skips the global wipe)
 * @returns {Promise<{ guilds: number, total: number, commands: number }>}
 */
export async function deployCommands(client, { guildId } = {}) {
  const payload = client.commands.map((cmd) => cmd.data.toJSON());
  const rest = new REST().setToken(config.discord.token);
  const appId = config.discord.clientId;

  // Wipe global commands so stale / ungated copies stop showing everywhere.
  // Skipped when targeting a single guild (e.g. a fresh guildCreate).
  if (!guildId) {
    await rest.put(Routes.applicationCommands(appId), { body: [] });
    logger.info('🧹 Cleared global slash commands');
  }

  const guildIds = guildId ? [guildId] : [...client.guilds.cache.keys()];

  let ok = 0;
  for (const id of guildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(appId, id), { body: payload });
      ok++;
    } catch (err) {
      logger.error('Failed to register commands for guild', { guildId: id, error: err.message });
    }
  }

  logger.info(`✅ Registered ${payload.length} commands to ${ok}/${guildIds.length} guild(s)`);
  return { guilds: ok, total: guildIds.length, commands: payload.length };
}
