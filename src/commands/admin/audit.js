// src/commands/admin/audit.js
// ─────────────────────────────────────────────────────────────────────────────
// /audit — Scan the shadow system for missing or broken configuration and
//          optionally fix everything with one button click.
//
// Checks:
//   • Mod queue channel is valid
//   • Every "Group *" role has a matching "Shadowed <name>" role
//   • Every category accessible by a "Group *" role has a shadow category
//   • Every channel inside those categories has a shadow channel in the DB
//
// A "Fix Issues" button is shown when problems are found. Clicking it creates
// whatever is missing and updates the DB — no manual re-setup required.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import {
  getGuildSettings,
  getChannelMappingsForGuild,
  upsertChannelMappings,
  upsertGuildSettings,
} from '../../services/supabase.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { COLORS, EMOJI } from '../../config/constants.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('audit')
  .setDescription('Scan the shadow system for issues and optionally fix them')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Run analysis and show report
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { guild } = interaction;
  await guild.channels.fetch();
  await guild.roles.fetch();

  const [settings, allMappings] = await Promise.all([
    getGuildSettings(guild.id),
    getChannelMappingsForGuild(guild.id),
  ]);

  const mappingMap = new Map(allMappings.map((m) => [m.original_channel_id, m]));
  const report = buildReport(guild, settings, mappingMap);
  const { embed, issueCount } = buildReportEmbed(report);

  const components = [];
  if (issueCount > 0) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('audit_fix')
          .setLabel(`Fix ${issueCount} Issue${issueCount !== 1 ? 's' : ''}`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔧'),
      ),
    );
  }

  return interaction.editReply({ embeds: [embed], components });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Apply fixes (called from interactionCreate on audit_fix button)
// ─────────────────────────────────────────────────────────────────────────────

export async function handleAuditFix(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Disable the Fix button on the original audit message
  try {
    await interaction.message.edit({ components: [] });
  } catch { }

  const { guild } = interaction;
  await guild.channels.fetch();
  await guild.roles.fetch();

  const [settings, allMappings] = await Promise.all([
    getGuildSettings(guild.id),
    getChannelMappingsForGuild(guild.id),
  ]);

  const mappingMap = new Map(allMappings.map((m) => [m.original_channel_id, m]));
  const report = buildReport(guild, settings, mappingMap);

  if (report.issueCount === 0) {
    return interaction.editReply({
      embeds: [successEmbed('Nothing to Fix', 'Everything is already configured correctly.')],
    });
  }

  const fixes = [];
  const newMappings = [];

  try {
    // ── Fix mod queue if missing ──────────────────────────────────────────────
    let modQueueChannel = report.modQueue.channel;

    if (!modQueueChannel) {
      modQueueChannel = await guild.channels.create({
        name: 'mod-queue',
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        ],
        topic: 'Pending shadowban reviews. Use the buttons to Approve, Reject, or Release.',
        reason: 'Shadowban bot — audit fix',
      });
      await upsertGuildSettings(guild.id, { mod_queue_channel_id: modQueueChannel.id });
      fixes.push(`${EMOJI.SUCCESS} Created **#mod-queue**`);
    }

    // ── Fix per-group issues ──────────────────────────────────────────────────
    for (const groupInfo of report.groups) {
      const { groupRole } = groupInfo;
      let { shadowRole } = groupInfo;

      // Create missing shadow role
      if (!shadowRole) {
        const shadowRoleName = `Shadowed ${groupRole.name}`;
        shadowRole = await guild.roles.create({
          name: shadowRoleName,
          colors: { primaryColor: 0x2c2f33 },
          hoist: false,
          mentionable: false,
          reason: 'Shadowban bot — audit fix',
        });
        fixes.push(`${EMOJI.SUCCESS} Created role **${shadowRoleName}**`);
      }

      for (const catInfo of groupInfo.categories) {
        const { category, channels } = catInfo;
        let { shadowCategory } = catInfo;

        // Create missing shadow category
        if (!shadowCategory) {
          shadowCategory = await guild.channels.create({
            name: `🔒 ${category.name}`,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
              { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
              copyRoleOverwrite(category, groupRole.id, shadowRole.id, [PermissionFlagsBits.ViewChannel]),
            ],
            reason: 'Shadowban bot — audit fix',
          });
          fixes.push(`${EMOJI.SUCCESS} Created shadow category **🔒 ${category.name}**`);
        }

        for (const chInfo of channels) {
          if (chInfo.shadowChannel) {
            // Already fine — keep mapping, update role IDs
            newMappings.push({
              originalChannelId: chInfo.channel.id,
              shadowChannelId: chInfo.shadowChannel.id,
              groupRoleId: groupRole.id,
              shadowRoleId: shadowRole.id,
            });
            continue;
          }

          // Create missing shadow channel
          const shadowChannel = await guild.channels.create({
            name: chInfo.channel.name.slice(0, 100),
            type: ChannelType.GuildText,
            parent: shadowCategory.id,
            permissionOverwrites: [
              { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
              copyRoleOverwrite(chInfo.channel, groupRole.id, shadowRole.id),
            ],
            topic: `Shadow mirror of #${chInfo.channel.name}.`,
            reason: 'Shadowban bot — audit fix',
          });

          newMappings.push({
            originalChannelId: chInfo.channel.id,
            shadowChannelId: shadowChannel.id,
            groupRoleId: groupRole.id,
            shadowRoleId: shadowRole.id,
          });

          fixes.push(`${EMOJI.SUCCESS} Created shadow channel **#${chInfo.channel.name}** (${groupRole.name})`);
        }
      }
    }

    if (newMappings.length > 0) {
      await upsertChannelMappings(guild.id, newMappings);
    }

    logger.info('Audit fix complete', {
      guildId: guild.id,
      admin: interaction.user.tag,
      fixCount: fixes.length,
      mappedChannels: newMappings.length,
    });

    return interaction.editReply({
      embeds: [successEmbed('Fixes Applied', fixes.join('\n') || 'No changes were needed.')],
    });

  } catch (err) {
    logger.error('Audit fix failed', { guildId: guild.id, error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('Fix Failed', `Something went wrong: ${err.message}\n\nMake sure the bot has **Administrator** permission.`)],
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

function buildReport(guild, settings, mappingMap) {
  let issueCount = 0;

  // Mod queue
  const mqChannelId = settings?.mod_queue_channel_id ?? null;
  const mqChannel = mqChannelId ? guild.channels.cache.get(mqChannelId) : null;
  if (!mqChannel) issueCount++;
  const modQueue = { valid: !!mqChannel, channel: mqChannel, channelId: mqChannelId };

  // All roles starting with "Group", sorted by name
  const groupRoles = [...guild.roles.cache.values()]
    .filter((r) => r.name.startsWith('Group'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const groups = groupRoles.map((groupRole) => {
    const shadowRoleName = `Shadowed ${groupRole.name}`;
    const shadowRole = guild.roles.cache.find((r) => r.name === shadowRoleName) ?? null;
    if (!shadowRole) issueCount++;

    // Categories where this group role has explicit ViewChannel access
    const categories = [...guild.channels.cache.values()]
      .filter((c) => {
        if (c.type !== ChannelType.GuildCategory) return false;
        const ow = c.permissionOverwrites.cache.get(groupRole.id);
        return ow?.allow.has(PermissionFlagsBits.ViewChannel);
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((category) => {
        const shadowCatName = `🔒 ${category.name}`;
        const shadowCategory = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name === shadowCatName,
        ) ?? null;

        const channels = [...guild.channels.cache.values()]
          .filter((c) => c.parentId === category.id)
          .sort((a, b) => a.position - b.position)
          .map((channel) => {
            const mapping = mappingMap.get(channel.id) ?? null;
            const shadowChannel = mapping
              ? guild.channels.cache.get(mapping.shadow_channel_id) ?? null
              : null;
            if (!shadowChannel) issueCount++;
            return { channel, mapping, shadowChannel };
          });

        return { category, shadowCategory, channels };
      });

    return { groupRole, shadowRole, categories };
  });

  return { modQueue, groups, issueCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT FORMATTING
// ─────────────────────────────────────────────────────────────────────────────

function buildReportEmbed(report) {
  const { modQueue, groups, issueCount } = report;
  const allOk = issueCount === 0;
  const fields = [];

  // Mod queue field
  fields.push({
    name: '🛡️ Mod Queue',
    value: modQueue.valid
      ? `✅ <#${modQueue.channelId}>`
      : '❌ Missing — will be created on fix',
    inline: false,
  });

  // One field per Group role
  for (const { groupRole, shadowRole, categories } of groups) {
    const lines = [];

    lines.push(
      shadowRole
        ? `Shadow role: ✅ **${shadowRole.name}**`
        : `Shadow role: ❌ **Shadowed ${groupRole.name}** — missing`,
    );

    if (categories.length === 0) {
      lines.push(`\n${EMOJI.WARNING} No categories found with access for this role`);
    }

    for (const { category, shadowCategory, channels } of categories) {
      lines.push(
        shadowCategory
          ? `\n📁 ${category.name} → ✅ 🔒 ${category.name}`
          : `\n📁 ${category.name} → ❌ no shadow category`,
      );

      for (const { channel, shadowChannel } of channels) {
        lines.push(
          shadowChannel
            ? `  • #${channel.name} ✅`
            : `  • #${channel.name} ❌ no shadow channel`,
        );
      }
    }

    let value = lines.join('\n');
    if (value.length > 1020) value = value.slice(0, 1020) + '…';

    fields.push({ name: `👥 ${groupRole.name}`, value, inline: false });
  }

  if (groups.length === 0) {
    fields.push({
      name: '👥 Groups',
      value: `${EMOJI.WARNING} No roles starting with **"Group"** found in this server.\n\nMake sure your group roles are named \`Group 1\`, \`Group 2\`, etc.`,
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(allOk ? COLORS.SUCCESS : COLORS.WARNING)
    .setTitle('🔍 Shadow System Audit')
    .setDescription(
      allOk
        ? '✅ Everything is configured correctly.'
        : `Found **${issueCount}** issue${issueCount !== 1 ? 's' : ''}. Click **Fix Issues** to resolve them automatically.`,
    )
    .addFields(fields)
    .setTimestamp();

  return { embed, issueCount };
}

function copyRoleOverwrite(channel, sourceRoleId, targetRoleId, fallbackAllow = []) {
  const sourceOverwrite = channel.permissionOverwrites.cache.get(sourceRoleId);

  if (!sourceOverwrite) {
    return {
      id: targetRoleId,
      allow: fallbackAllow,
      deny: [],
    };
  }

  return {
    id: targetRoleId,
    allow: sourceOverwrite.allow.bitfield,
    deny: sourceOverwrite.deny.bitfield,
  };
}
