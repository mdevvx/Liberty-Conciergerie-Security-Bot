// src/commands/utility/status.js
// ─────────────────────────────────────────────────────────────────────────────
// /status — Bot health + full per-server configuration:
//   • Enabled state, uptime, ping
//   • Setup status, mod-queue channel, monitored channel count
//   • Quiet-hours window (and whether it's active right now)
//   • Whitelisted roles
//   • AI system prompt
//   • Message stats (total shadowed / pending review)
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import {
  getGuildSettings,
  getChannelMappingsForGuild,
  getWhitelistedRoles,
} from '../../services/supabase.js';
import supabase from '../../services/supabase.js';
import { COLORS, EMOJI } from '../../config/constants.js';
import { isInQuietWindow } from '../../utils/timezone.js';
import { errorEmbed } from '../../utils/embed.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show the current bot status and configuration for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const YES = '✅';
const NO = '❌';

export async function execute(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const [settings, mappings, whitelistRoleIds] = await Promise.all([
      getGuildSettings(interaction.guildId),
      getChannelMappingsForGuild(interaction.guildId),
      getWhitelistedRoles(interaction.guildId),
    ]);

    const enabled = settings ? settings.enabled : true;

    // ── Message stats ──────────────────────────────────────────────────────
    const { count: totalShadowed } = await supabase
      .from('shadowban_messages')
      .select('*', { count: 'exact', head: true })
      .eq('guild_id', interaction.guildId);

    const { count: pendingCount } = await supabase
      .from('shadowban_messages')
      .select('*', { count: 'exact', head: true })
      .eq('guild_id', interaction.guildId)
      .eq('status', 'pending');

    const { count: pendingSuspect } = await supabase
      .from('shadowban_messages')
      .select('*', { count: 'exact', head: true })
      .eq('guild_id', interaction.guildId)
      .eq('status', 'pending')
      .eq('classification', 'SUSPECT');

    const pendingToxic = (pendingCount ?? 0) - (pendingSuspect ?? 0);

    // ── Uptime ─────────────────────────────────────────────────────────────
    const uptimeSeconds = Math.floor(process.uptime());
    const h = Math.floor(uptimeSeconds / 3600);
    const m = Math.floor((uptimeSeconds % 3600) / 60);
    const s = uptimeSeconds % 60;
    const uptimeStr = `${h}h ${m}m ${s}s`;

    // ── Configuration summary ──────────────────────────────────────────────
    const monitoredCount = mappings.length;
    const distinctGroups = new Set(
      mappings.map((r) => r.group_role_id).filter(Boolean),
    ).size;

    const modQueueId = settings?.mod_queue_channel_id ?? null;
    const modQueueExists = modQueueId
      ? !!(await interaction.guild.channels.fetch(modQueueId).catch(() => null))
      : false;
    const modQueueStr = !modQueueId
      ? `${NO} Not configured`
      : modQueueExists
        ? `${YES} <#${modQueueId}>`
        : `${EMOJI.WARNING} <#${modQueueId}> — channel missing`;

    const isConfigured = monitoredCount > 0 && modQueueId && modQueueExists;
    const setupStr = isConfigured
      ? `${YES} Ready`
      : `${NO} Incomplete — run \`/setup\``;

    // ── Quiet hours ────────────────────────────────────────────────────────
    const hasQuiet =
      settings?.quiet_timezone && settings?.quiet_start && settings?.quiet_end;
    let quietStr;
    if (!hasQuiet) {
      quietStr = `${NO} Not configured — all SUSPECT messages go to the mod queue`;
    } else {
      const active = isInQuietWindow(
        settings.quiet_timezone,
        settings.quiet_start,
        settings.quiet_end,
      );
      const allDay = settings.quiet_start === settings.quiet_end;
      quietStr =
        `${YES} \`${settings.quiet_timezone}\` · ${settings.quiet_start} – ${settings.quiet_end}\n` +
        `${active ? '🌙 **Active now** — SUSPECT messages are silently deleted' : '☀️ Inactive right now'}` +
        (allDay ? `\n${EMOJI.WARNING} Start = end → treated as a **24h** window (always active)` : '');
    }

    // ── Whitelisted roles ──────────────────────────────────────────────────
    const whitelistStr =
      whitelistRoleIds.size === 0
        ? `${NO} None`
        : [...whitelistRoleIds].map((id) => `<@&${id}>`).join(', ');

    // ── AI system prompt ───────────────────────────────────────────────────
    const promptStr = settings?.ai_system_prompt
      ? `${YES} Set (${settings.ai_system_prompt.length.toLocaleString()} chars)`
      : `${NO} Not set — \`/ask\` is unavailable`;

    // ── Build embed ────────────────────────────────────────────────────────
    const embed = new EmbedBuilder()
      .setColor(enabled ? COLORS.SUCCESS : COLORS.NEUTRAL)
      .setTitle(`${EMOJI.BOT} Shadowban Bot — Status`)
      .addFields(
        { name: `${EMOJI.TOGGLE_ON} Bot State`, value: enabled ? '`Enabled`' : '`Disabled`', inline: true },
        { name: '⏱️ Uptime', value: `\`${uptimeStr}\``, inline: true },
        { name: '📡 Ping', value: `\`${client.ws.ping}ms\``, inline: true },

        { name: '🧩 Setup', value: setupStr, inline: false },
        { name: `${EMOJI.MOD} Mod Queue`, value: modQueueStr, inline: false },
        {
          name: '👁️ Monitored Channels',
          value: monitoredCount > 0
            ? `\`${monitoredCount}\` channel${monitoredCount !== 1 ? 's' : ''} across \`${distinctGroups}\` group${distinctGroups !== 1 ? 's' : ''}`
            : `${NO} None mapped`,
          inline: false,
        },
        { name: '🌙 Quiet Hours', value: quietStr, inline: false },
        { name: '🛡️ Whitelisted Roles', value: whitelistStr, inline: false },
        { name: '🤖 AI System Prompt', value: promptStr, inline: false },

        { name: '🌐 Servers', value: `\`${client.guilds.cache.size}\``, inline: true },
        { name: '📊 Total Shadowed', value: `\`${totalShadowed ?? 0}\``, inline: true },
        {
          name: `${EMOJI.LOADING} Pending Review`,
          value: (pendingCount ?? 0) === 0
            ? '`0`'
            : `\`${pendingCount}\` — ${pendingSuspect ?? 0} SUSPECT (awaiting mod action)`
              + (pendingToxic > 0 ? ` · ${pendingToxic} TOXIC (silent, no card)` : ''),
          inline: false,
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
