// src/commands/admin/toggle.js
// ─────────────────────────────────────────────────────────────────────────────
// /toggle — Enable or disable the shadowban bot for this server.
// Only members with Administrator permission can use this.
// This command always works even when the bot is disabled (bypass in interactionCreate).
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getGuildSettings, upsertGuildSettings } from '../../services/supabase.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { EMOJI } from '../../config/constants.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('toggle')
  .setDescription('Enable or disable the shadowban bot in this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const settings = await getGuildSettings(interaction.guildId);
    const currentlyEnabled = settings ? settings.enabled : true;
    const newState = !currentlyEnabled;

    await upsertGuildSettings(interaction.guildId, { enabled: newState });

    const emoji = newState ? EMOJI.TOGGLE_ON : EMOJI.TOGGLE_OFF;
    const label = newState ? 'Enabled' : 'Disabled';
    const desc = newState
      ? 'The shadowban bot is now **active**. Messages will be classified and filtered.'
      : 'The shadowban bot is now **inactive**. No messages will be filtered and all commands are locked.';

    logger.info(`${emoji} Bot ${label} in guild ${interaction.guild.name}`, {
      guildId: interaction.guildId,
      mod: interaction.user.tag,
    });

    return interaction.editReply({
      embeds: [successEmbed(`Bot ${label}`, desc)],
    });

  } catch (err) {
    logger.error('toggle command failed', { guildId: interaction.guildId, error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('Toggle Failed', 'Could not update bot state. Please try again.')],
    });
  }
}
