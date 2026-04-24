// src/commands/mod/unshadowban.js
// ─────────────────────────────────────────────────────────────────────────────
// /unshadowban <user> — Remove the Shadow role from a user.
// Requires Manage Messages permission (mod-level).
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, errorEmbed, warningEmbed } from '../../utils/embed.js';
import { EMOJI } from '../../config/constants.js';
import logger from '../../utils/logger.js';

const SHADOW_ROLE_NAME = 'Shadowed';

export const data = new SlashCommandBuilder()
  .setName('unshadowban')
  .setDescription('Remove the shadowban from a user — restores normal visibility')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addUserOption((opt) =>
    opt.setName('user').setDescription('The user to unshadowban').setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName('reason').setDescription('Reason (logged)').setRequired(false)
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getMember('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!target) {
    return interaction.editReply({
      embeds: [errorEmbed('User Not Found', 'That user is not in this server.')],
    });
  }

  try {
    const shadowRole = interaction.guild.roles.cache.find((r) => r.name === SHADOW_ROLE_NAME);

    // If the role doesn't exist at all, they're definitely not shadowbanned
    if (!shadowRole || !target.roles.cache.has(shadowRole.id)) {
      return interaction.editReply({
        embeds: [warningEmbed('Not Shadowbanned', `${target} does not have the Shadow role.`)],
      });
    }

    await target.roles.remove(shadowRole, `Unshadowban by ${interaction.user.tag}: ${reason}`);

    logger.info(`${EMOJI.RELEASE} Unshadowban: ${target.user.tag}`, {
      guildId: interaction.guildId,
      mod: interaction.user.tag,
      reason,
    });

    return interaction.editReply({
      embeds: [
        successEmbed(
          'Shadowban Removed',
          `${EMOJI.RELEASE} **${target.user.tag}** can now post normally again.\n📝 **Reason:** ${reason}`
        ),
      ],
    });

  } catch (err) {
    logger.error('unshadowban command failed', { guildId: interaction.guildId, error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('Failed', `Could not remove Shadow role: \`${err.message}\``)],
    });
  }
}
