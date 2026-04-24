// src/commands/mod/shadowban.js
// ─────────────────────────────────────────────────────────────────────────────
// /shadowban <user> [reason] — Manually assign the Shadow role to a user.
// Requires Manage Messages permission (mod-level).
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, errorEmbed, warningEmbed } from '../../utils/embed.js';
import { EMOJI } from '../../config/constants.js';
import logger from '../../utils/logger.js';

const SHADOW_ROLE_NAME = 'Shadowed';

export const data = new SlashCommandBuilder()
  .setName('shadowban')
  .setDescription('Manually shadowban a user — their messages become invisible to others')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addUserOption((opt) =>
    opt.setName('user').setDescription('The user to shadowban').setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName('reason').setDescription('Reason for the shadowban (logged)').setRequired(false)
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getMember('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!target) {
    return interaction.editReply({
      embeds: [errorEmbed('User Not Found', 'That user is not in this server.')],
    });
  }

  if (target.id === interaction.user.id) {
    return interaction.editReply({
      embeds: [warningEmbed('Nice Try', "You can't shadowban yourself.")],
    });
  }

  if (target.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.editReply({
      embeds: [warningEmbed('Not Allowed', "You can't shadowban a moderator or admin.")],
    });
  }

  // ── Assign Shadow role ────────────────────────────────────────────────────
  try {
    let shadowRole = interaction.guild.roles.cache.find((r) => r.name === SHADOW_ROLE_NAME);

    if (!shadowRole) {
      shadowRole = await interaction.guild.roles.create({
        name: SHADOW_ROLE_NAME,
        colors: { primaryColor: 0x2c2f33 },
        reason: 'Shadowban bot — auto-created Shadow role',
      });
    }

    if (target.roles.cache.has(shadowRole.id)) {
      return interaction.editReply({
        embeds: [warningEmbed('Already Shadowed', `${target} is already shadowbanned.`)],
      });
    }

    await target.roles.add(shadowRole, `Manual shadowban by ${interaction.user.tag}: ${reason}`);

    logger.info(`${EMOJI.SHADOW} Manual shadowban: ${target.user.tag}`, {
      guildId: interaction.guildId,
      mod: interaction.user.tag,
      reason,
    });

    return interaction.editReply({
      embeds: [
        successEmbed(
          'User Shadowbanned',
          `${EMOJI.SHADOW} **${target.user.tag}** has been shadowbanned.\n📝 **Reason:** ${reason}`
        ),
      ],
    });

  } catch (err) {
    logger.error('shadowban command failed', { guildId: interaction.guildId, error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('Shadowban Failed', `Could not assign Shadow role: \`${err.message}\``)],
    });
  }
}
