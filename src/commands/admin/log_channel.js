// src/commands/admin/log_channel.js
// ─────────────────────────────────────────────────────────────────────────────
// /log_channel channel:#bot-logs — Set the channel the bot mirrors its activity
// log to. Pick the same channel again to leave it unchanged; there is no
// separate "disable" — clear it by removing the column value if ever needed.
//
// Once set, every guild-tagged log line (classification results, shadowbans,
// mod-queue posts, errors, command runs, …) is batched and posted to that
// channel by the bot. File + console logging are unaffected.
// Current setting is shown in /status.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
} from 'discord.js';
import { upsertGuildSettings, invalidateLogChannelCache } from '../../services/supabase.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('log_channel')
  .setDescription('Set the channel the bot posts its activity log to')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((opt) =>
    opt
      .setName('channel')
      .setDescription('Text channel for the activity log')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true),
  );

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = interaction.options.getChannel('channel', true);
  const me = interaction.guild.members.me;
  const perms = channel.permissionsFor(me);

  if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          'Missing Access',
          `I need **View Channel** and **Send Messages** in ${channel} to post logs there.`,
        ),
      ],
    });
  }

  await upsertGuildSettings(interaction.guildId, { log_channel_id: channel.id });
  invalidateLogChannelCache(interaction.guildId);

  logger.info(`Activity log channel set to #${channel.name}`, {
    guildId: interaction.guildId,
    admin: interaction.user.tag,
  });

  await channel
    .send('```\n[log_channel] Activity logging enabled — the bot will post here.\n```')
    .catch(() => {});

  return interaction.editReply({
    embeds: [successEmbed('Log Channel Set', `Bot activity will now be posted to ${channel}.`)],
  });
}
