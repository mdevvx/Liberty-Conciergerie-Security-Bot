// src/commands/admin/setup.js
// ─────────────────────────────────────────────────────────────────────────────
// /setup — Fully automated server setup.
// Creates everything the shadowban system needs in one command:
//   • Shadowed role  (hidden, dark colour, no extra perms)
//   • 🔒 Shadow Zone category  (invisible to @everyone, visible to Shadowed)
//   • #shadow-hold channel inside that category
//   • #mod-queue channel  (invisible to everyone except admins)
// All IDs are saved to Supabase. Safe to re-run — role is reused if it exists.
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { upsertGuildSettings } from '../../services/supabase.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { EMOJI } from '../../config/constants.js';
import logger from '../../utils/logger.js';

const SHADOW_ROLE_NAME = 'Shadowed';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Auto-create the Shadowed role, shadow category, and mod queue for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const { guild } = interaction;

  try {
    // ── Step 1: Create or reuse the Shadowed role ─────────────────────────────
    let shadowedRole = guild.roles.cache.find((r) => r.name === SHADOW_ROLE_NAME);
    const roleCreated = !shadowedRole;

    if (!shadowedRole) {
      shadowedRole = await guild.roles.create({
        name: SHADOW_ROLE_NAME,
        colors: { primaryColor: 0x2c2f33 },
        hoist: false,
        mentionable: false,
        reason: 'Shadowban bot — auto setup',
      });
      logger.info(`🛡️  Created Shadowed role`, { guildId: guild.id });
    }

    // ── Step 2: Create the shadow category ────────────────────────────────────
    // @everyone: cannot see it at all
    // Shadowed:  can see it, but cannot send messages or add reactions
    const shadowCategory = await guild.channels.create({
      name: '🔒 Shadow Zone',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: shadowedRole.id,
          allow: [PermissionFlagsBits.ViewChannel],
          deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
        },
      ],
      reason: 'Shadowban bot — auto setup',
    });

    // ── Step 3: Create #shadow-hold inside that category ──────────────────────
    // Inherits category permissions — Shadowed can read, can't write
    const shadowChannel = await guild.channels.create({
      name: 'shadow-hold',
      type: ChannelType.GuildText,
      parent: shadowCategory.id,
      topic: 'Intercepted messages appear here. Visible only to their authors.',
      reason: 'Shadowban bot — auto setup',
    });

    // ── Step 4: Create #mod-queue (admins only) ───────────────────────────────
    // Neither @everyone nor Shadowed can see this
    const modQueueChannel = await guild.channels.create({
      name: 'mod-queue',
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: shadowedRole.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
      ],
      topic: 'Pending shadowban reviews. Use the buttons to Approve, Reject, or Release.',
      reason: 'Shadowban bot — auto setup',
    });

    // ── Step 5: Save everything to Supabase ───────────────────────────────────
    await upsertGuildSettings(interaction.guildId, {
      shadow_channel_id: shadowChannel.id,
      mod_queue_channel_id: modQueueChannel.id,
      enabled: true,
    });

    logger.info('Guild setup complete', {
      guildId: guild.id,
      shadowedRoleId: shadowedRole.id,
      shadowCategoryId: shadowCategory.id,
      shadowChannelId: shadowChannel.id,
      modQueueChannelId: modQueueChannel.id,
      admin: interaction.user.tag,
    });

    const lines = [
      `${roleCreated ? EMOJI.SUCCESS + ' Created' : EMOJI.INFO + ' Reused existing'} **Shadowed** role`,
      `${EMOJI.SUCCESS} Created **🔒 Shadow Zone** category`,
      `${EMOJI.SHADOW} Shadow channel: ${shadowChannel}`,
      `${EMOJI.MOD} Mod queue: ${modQueueChannel}`,
      '',
      '**One manual step required:**',
      `Go to each of your normal channels/categories and add **Deny ViewChannel** for the \`Shadowed\` role so shadowed users cannot see them.`,
    ];

    return interaction.editReply({
      embeds: [successEmbed('Setup Complete', lines.join('\n'))],
    });

  } catch (err) {
    logger.error('setup command failed', { guildId: interaction.guildId, error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('Setup Failed', `Something went wrong: ${err.message}\n\nMake sure the bot has **Administrator** permission.`)],
    });
  }
}
