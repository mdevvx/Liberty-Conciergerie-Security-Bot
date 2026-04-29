// src/commands/admin/sync.js
// ─────────────────────────────────────────────────────────────────────────────
// /sync — Register all slash commands globally with Discord.
// Only bot owner / Administrator can run this.
// Global commands take up to 1 hour to propagate — guild commands are instant
// but that's handled by Railway deploy, not a runtime command.
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, REST, Routes, MessageFlags } from 'discord.js';
import { config } from '../../config/config.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embed.js';
import { EMOJI } from '../../config/constants.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('sync')
  .setDescription('Sync all slash commands globally with Discord (Admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Build the payload from the loaded commands collection
    const commandPayloads = client.commands.map((cmd) => cmd.data.toJSON());

    const rest = new REST().setToken(config.discord.token);

    logger.info(`🔄 Syncing ${commandPayloads.length} commands globally...`, {
      guildId: interaction.guildId,
    });

    await interaction.editReply({
      embeds: [infoEmbed('Syncing...', `${EMOJI.LOADING} Registering **${commandPayloads.length}** commands with Discord. Please wait...`)],
    });

    // Register globally — takes up to 1 hour to propagate
    await rest.put(
      Routes.applicationCommands(config.discord.clientId),
      { body: commandPayloads }
    );

    const commandList = commandPayloads.map((c) => `\`/${c.name}\``).join(', ');

    logger.info(`✅ Synced ${commandPayloads.length} global commands`, {
      guildId: interaction.guildId,
      mod: interaction.user.tag,
    });

    return interaction.editReply({
      embeds: [
        successEmbed(
          'Commands Synced',
          `Successfully registered **${commandPayloads.length}** commands globally.\n\n${commandList}\n\n⏳ Global commands may take **up to 1 hour** to appear in all servers.`
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
