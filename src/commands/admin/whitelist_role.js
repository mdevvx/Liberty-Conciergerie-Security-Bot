// src/commands/admin/whitelist_role.js
// ─────────────────────────────────────────────────────────────────────────────
// /whitelist_role — Manage roles that are exempt from message classification.
//
//   /whitelist_role add    role:@Role  — exempt a role
//   /whitelist_role remove role:@Role  — remove the exemption
//   /whitelist_role list               — show all whitelisted roles
//
// Members who hold at least one whitelisted role are skipped entirely —
// their messages are never classified, shadowed, or flagged.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import {
  getWhitelistedRoles,
  addWhitelistedRole,
  removeWhitelistedRole,
} from '../../services/supabase.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embed.js';
import { EMOJI } from '../../config/constants.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('whitelist_role')
  .setDescription('Manage roles that are exempt from message moderation')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Exempt a role from message moderation')
      .addRoleOption((opt) =>
        opt.setName('role').setDescription('Role to whitelist').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove a role from the whitelist')
      .addRoleOption((opt) =>
        opt.setName('role').setDescription('Role to remove').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('Show all currently whitelisted roles'),
  );

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sub = interaction.options.getSubcommand();

  // ── ADD ───────────────────────────────────────────────────────────────────
  if (sub === 'add') {
    const role = interaction.options.getRole('role', true);

    try {
      await addWhitelistedRole(interaction.guildId, role.id);

      logger.info(`Whitelisted role ${role.name}`, {
        guildId: interaction.guildId,
        roleId:  role.id,
        admin:   interaction.user.tag,
      });

      return interaction.editReply({
        embeds: [successEmbed(
          'Role Whitelisted',
          `${role} is now exempt from message moderation.\nMembers with this role will never be classified, shadowed, or flagged.`,
        )],
      });
    } catch (err) {
      logger.error('whitelist_role add failed', { guildId: interaction.guildId, error: err.message });
      return interaction.editReply({
        embeds: [errorEmbed('Failed', `Could not whitelist role: ${err.message}`)],
      });
    }
  }

  // ── REMOVE ────────────────────────────────────────────────────────────────
  if (sub === 'remove') {
    const role = interaction.options.getRole('role', true);

    // Check it's actually whitelisted before attempting removal
    const current = await getWhitelistedRoles(interaction.guildId);
    if (!current.has(role.id)) {
      return interaction.editReply({
        embeds: [errorEmbed('Not Whitelisted', `${role} is not on the whitelist.`)],
      });
    }

    try {
      await removeWhitelistedRole(interaction.guildId, role.id);

      logger.info(`Removed whitelist for role ${role.name}`, {
        guildId: interaction.guildId,
        roleId:  role.id,
        admin:   interaction.user.tag,
      });

      return interaction.editReply({
        embeds: [successEmbed(
          'Role Removed',
          `${role} has been removed from the whitelist. Members with this role will now go through normal moderation.`,
        )],
      });
    } catch (err) {
      logger.error('whitelist_role remove failed', { guildId: interaction.guildId, error: err.message });
      return interaction.editReply({
        embeds: [errorEmbed('Failed', `Could not remove role: ${err.message}`)],
      });
    }
  }

  // ── LIST ──────────────────────────────────────────────────────────────────
  if (sub === 'list') {
    const roleIds = await getWhitelistedRoles(interaction.guildId);

    if (roleIds.size === 0) {
      return interaction.editReply({
        embeds: [infoEmbed(
          'Whitelisted Roles',
          'No roles are currently whitelisted. Use `/whitelist_role add` to exempt a role.',
        )],
      });
    }

    const lines = [...roleIds].map((id) => `${EMOJI.SUCCESS} <@&${id}>`);

    return interaction.editReply({
      embeds: [infoEmbed(
        `Whitelisted Roles (${roleIds.size})`,
        lines.join('\n'),
      )],
    });
  }
}
