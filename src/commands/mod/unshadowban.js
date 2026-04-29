// src/commands/mod/unshadowban.js
// ─────────────────────────────────────────────────────────────────────────────
// /unshadowban <user> — Remove the user's shadow role and restore their group role.
// Looks up the configured role mappings from the DB to find the correct pair.
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getRoleMappingsForGuild } from '../../services/supabase.js';
import { successEmbed, errorEmbed, warningEmbed } from '../../utils/embed.js';
import { EMOJI } from '../../config/constants.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('unshadowban')
  .setDescription('Remove the shadowban from a user — restores their group role')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addUserOption((opt) =>
    opt.setName('user').setDescription('The user to unshadowban').setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName('reason').setDescription('Reason (logged)').setRequired(false),
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

  try {
    // Load all group ↔ shadow role pairs for this guild
    const roleMappings = await getRoleMappingsForGuild(interaction.guildId);

    // Find which shadow role(s) the user currently has
    const activeMapping = roleMappings.find(
      ({ shadow_role_id }) => shadow_role_id && target.roles.cache.has(shadow_role_id),
    );

    if (!activeMapping) {
      return interaction.editReply({
        embeds: [warningEmbed('Not Shadowbanned', `${target} does not have any shadow role assigned.`)],
      });
    }

    const shadowRole = interaction.guild.roles.cache.get(activeMapping.shadow_role_id);
    const groupRole = activeMapping.group_role_id
      ? interaction.guild.roles.cache.get(activeMapping.group_role_id)
      : null;

    // Remove shadow role
    if (shadowRole) {
      await target.roles.remove(shadowRole, `Unshadowban by ${interaction.user.tag}: ${reason}`);
    }

    // Restore group role
    if (groupRole && !target.roles.cache.has(groupRole.id)) {
      await target.roles.add(groupRole, `Unshadowban by ${interaction.user.tag}: ${reason}`);
    }

    logger.info(`${EMOJI.RELEASE} Unshadowban: ${target.user.tag}`, {
      guildId: interaction.guildId,
      mod: interaction.user.tag,
      shadowRole: shadowRole?.name,
      groupRole: groupRole?.name,
      reason,
    });

    const groupLine = groupRole ? `\n🎭 **Group role restored:** ${groupRole.name}` : '';

    return interaction.editReply({
      embeds: [
        successEmbed(
          'Shadowban Removed',
          `${EMOJI.RELEASE} **${target.user.tag}** can now access their group again.${groupLine}\n📝 **Reason:** ${reason}`,
        ),
      ],
    });

  } catch (err) {
    logger.error('unshadowban command failed', { guildId: interaction.guildId, error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('Failed', `Could not remove shadow role: \`${err.message}\``)],
    });
  }
}
