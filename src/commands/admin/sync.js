// src/commands/admin/sync.js
// ─────────────────────────────────────────────────────────────────────────────
// /sync — Re-register all slash commands for every server the bot is in.
// Only Administrators can run this.
//
// Commands are registered per-guild (instant) — never globally — so they only
// show up where the bot is actually a member, and Discord always has the
// current permission gating (admin commands stay hidden from normal members).
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { deployCommands } from '../../utils/deployCommands.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embed.js';
import { EMOJI } from '../../config/constants.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('sync')
  .setDescription('Re-register all slash commands for every server the bot is in (Admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await interaction.editReply({
      embeds: [infoEmbed('Syncing…', `${EMOJI.LOADING} Re-registering commands with Discord. Please wait…`)],
    });

    logger.info('🔄 /sync invoked', {
      guildId: interaction.guildId,
      admin: interaction.user.tag,
    });

    const { guilds, total, commands } = await deployCommands(client);

    logger.info(`✅ /sync complete — ${commands} commands to ${guilds}/${total} guild(s)`, {
      guildId: interaction.guildId,
      admin: interaction.user.tag,
    });

    return interaction.editReply({
      embeds: [
        successEmbed(
          'Commands Synced',
          `Registered **${commands}** commands to **${guilds}/${total}** server${total !== 1 ? 's' : ''}.\n\nGuild-scoped registration is instant — no propagation delay.`,
        ),
      ],
    });

  } catch (err) {
    logger.error('sync command failed', { error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('Sync Failed', `Could not register commands: \`${err.message}\``)],
    });
  }
}
