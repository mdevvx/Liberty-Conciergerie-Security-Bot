// src/commands/utility/status.js
// ─────────────────────────────────────────────────────────────────────────────
// /status — Show bot health, uptime, guild configuration, and message stats.
// Visible to anyone (no permission requirement) but shows guild-specific data.
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getGuildSettings } from '../../services/supabase.js';
import supabase from '../../services/supabase.js';
import { COLORS, EMOJI } from '../../config/constants.js';
import { errorEmbed } from '../../utils/embed.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show the current bot status and configuration for this server');

export async function execute(interaction, client) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const settings = await getGuildSettings(interaction.guildId);
    const enabled = settings ? settings.enabled : true;

    // ── Pull message stats from DB ──────────────────────────────────────────
    const { count: totalShadowed } = await supabase
      .from('shadow_messages')
      .select('*', { count: 'exact', head: true })
      .eq('guild_id', interaction.guildId);

    const { count: pendingCount } = await supabase
      .from('shadow_messages')
      .select('*', { count: 'exact', head: true })
      .eq('guild_id', interaction.guildId)
      .eq('status', 'pending');

    // ── Format uptime ───────────────────────────────────────────────────────
    const uptimeSeconds = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    // ── Channel mentions ────────────────────────────────────────────────────
    const shadowChannelStr = settings?.shadow_channel_id
      ? `<#${settings.shadow_channel_id}>`
      : '`Not configured`';

    const modQueueStr = settings?.mod_queue_channel_id
      ? `<#${settings.mod_queue_channel_id}>`
      : '`Not configured`';

    // ── Build embed ─────────────────────────────────────────────────────────
    const embed = new EmbedBuilder()
      .setColor(enabled ? COLORS.SUCCESS : COLORS.NEUTRAL)
      .setTitle(`${EMOJI.BOT} Shadowban Bot — Status`)
      .addFields(
        {
          name: `${EMOJI.TOGGLE_ON} Bot State`,
          value: enabled ? '`Enabled`' : '`Disabled`',
          inline: true,
        },
        {
          name: '⏱️ Uptime',
          value: `\`${uptimeStr}\``,
          inline: true,
        },
        {
          name: '📡 Ping',
          value: `\`${client.ws.ping}ms\``,
          inline: true,
        },
        {
          name: `${EMOJI.SHADOW} Shadow Channel`,
          value: shadowChannelStr,
          inline: true,
        },
        {
          name: `${EMOJI.MOD} Mod Queue`,
          value: modQueueStr,
          inline: true,
        },
        {
          name: '🌐 Servers',
          value: `\`${client.guilds.cache.size}\``,
          inline: true,
        },
        {
          name: '📊 Total Shadowed (this server)',
          value: `\`${totalShadowed ?? 0}\``,
          inline: true,
        },
        {
          name: `${EMOJI.LOADING} Pending Review`,
          value: `\`${pendingCount ?? 0}\``,
          inline: true,
        },
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });

  } catch (err) {
    logger.error('status command failed', { guildId: interaction.guildId, error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('Status Error', 'Could not retrieve bot status.')],
    });
  }
}
