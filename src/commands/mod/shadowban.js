// src/commands/mod/shadowban.js
// ─────────────────────────────────────────────────────────────────────────────
// /shadowban <user> [reason] — Manually shadowban a user.
// Looks up the user's current group role from the DB mappings,
// removes it, and assigns the corresponding shadow role.
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getRoleMappingsForGuild } from '../../services/supabase.js';
import { successEmbed, errorEmbed, warningEmbed } from '../../utils/embed.js';
import { EMOJI } from '../../config/constants.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('shadowban')
  .setDescription('Manually shadowban a user — removes their group role and assigns their shadow role')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addUserOption((opt) =>
    opt.setName('user').setDescription('The user to shadowban').setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName('reason').setDescription('Reason for the shadowban (logged)').setRequired(false),
  );

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const target = interaction.options.getMember('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';

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

  try {
    // Load all group ↔ shadow role pairs for this guild
    const roleMappings = await getRoleMappingsForGuild(interaction.guildId);

    // Find which group role the user currently has
    const activeMapping = roleMappings.find(
      ({ group_role_id }) => group_role_id && target.roles.cache.has(group_role_id),
    );

    if (!activeMapping) {
      return interaction.editReply({
        embeds: [errorEmbed(
          'No Group Found',
          `${target} is not a member of any configured group.\n\nRun \`/setup\` to configure group categories first.`,
        )],
      });
    }

    const groupRole = interaction.guild.roles.cache.get(activeMapping.group_role_id);
    const shadowRole = activeMapping.shadow_role_id
      ? interaction.guild.roles.cache.get(activeMapping.shadow_role_id)
      : null;

    // Check not already shadowed
    if (shadowRole && target.roles.cache.has(shadowRole.id)) {
      return interaction.editReply({
        embeds: [warningEmbed('Already Shadowed', `${target} already has the **${shadowRole.name}** role.`)],
      });
    }

    // Remove group role, add shadow role
    if (groupRole) {
      await target.roles.remove(groupRole, `Manual shadowban by ${interaction.user.tag}: ${reason}`);
    }

    if (shadowRole) {
      await target.roles.add(shadowRole, `Manual shadowban by ${interaction.user.tag}: ${reason}`);
    }

    logger.info(`${EMOJI.SHADOW} Manual shadowban: ${target.user.tag}`, {
      guildId: interaction.guildId,
      mod: interaction.user.tag,
      groupRole: groupRole?.name,
      shadowRole: shadowRole?.name,
      reason,
    });

    return interaction.editReply({
      embeds: [
        successEmbed(
          'User Shadowbanned',
          `${EMOJI.SHADOW} **${target.user.tag}** has been shadowbanned.\n🎭 **Group role removed:** ${groupRole?.name ?? 'none'}\n👁️ **Shadow role added:** ${shadowRole?.name ?? 'none'}\n📝 **Reason:** ${reason}`,
        ),
      ],
    });

  } catch (err) {
    logger.error('shadowban command failed', { guildId: interaction.guildId, error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('Shadowban Failed', `Could not swap roles: \`${err.message}\``)],
    });
  }
}
