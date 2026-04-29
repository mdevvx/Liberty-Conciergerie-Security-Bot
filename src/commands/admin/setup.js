// src/commands/admin/setup.js
// ─────────────────────────────────────────────────────────────────────────────
// /setup — Add one group at a time to the shadow system.
//
// Step 1 (execute):          Pick ONE category from a dropdown.
// Step 2 (handleCategorySelect): Message updates in-place to show a role picker
//                                for that category.
// Step 3 (handleRoleSelect): Bot creates:
//   • "Shadowed <RoleName>" shadow role (reused if it exists)
//   • "🔒 <Category Name>" shadow category visible only to the shadow role
//   • One mirror text channel per channel inside the category
//   • #mod-queue (reused if it already exists)
//   • Upserts channel + role mappings — does NOT wipe other groups
//
// Run /setup again to add the next group.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import {
  upsertGuildSettings,
  getGuildSettings,
  upsertChannelMappings,
} from '../../services/supabase.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embed.js';
import { EMOJI } from '../../config/constants.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Add a group to the shadow system — pick a category, then its group role')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Pick a category (single select)
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { guild } = interaction;

  await guild.channels.fetch();

  const categories = guild.channels.cache.filter(
    (c) => c.type === ChannelType.GuildCategory,
  );

  if (categories.size === 0) {
    return interaction.editReply({
      embeds: [errorEmbed('No Categories Found', 'This server has no categories. Create at least one before running setup.')],
    });
  }

  const options = [...categories.values()]
    .slice(0, 25)
    .map((cat) => {
      const count = guild.channels.cache.filter((c) => c.parentId === cat.id).size;
      return {
        label: cat.name.slice(0, 100),
        value: cat.id,
        description: `${count} channel${count !== 1 ? 's' : ''}`,
      };
    });

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('setup_cat_select')
      .setPlaceholder('Pick a category to shadow...')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options),
  );

  return interaction.editReply({
    embeds: [infoEmbed(
      'Setup — Step 1 of 2: Pick a Category',
      'Select the **category** you want to add to the shadow system.\n\nRun `/setup` again after this to add more groups one by one.',
    )],
    components: [row],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Category chosen → update message in-place with role picker
// ─────────────────────────────────────────────────────────────────────────────

export async function handleCategorySelect(interaction) {
  const categoryId = interaction.values[0];
  const category = interaction.guild.channels.cache.get(categoryId);

  if (!category) {
    return interaction.update({
      embeds: [errorEmbed('Category Not Found', 'That category no longer exists.')],
      components: [],
    });
  }

  const channelCount = interaction.guild.channels.cache.filter(
    (c) => c.parentId === categoryId,
  ).size;

  const row = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(`setup_role_select:${categoryId}`)
      .setPlaceholder('Pick the group role for this category...')
      .setMinValues(1)
      .setMaxValues(1),
  );

  return interaction.update({
    embeds: [infoEmbed(
      'Setup — Step 2 of 2: Pick the Group Role',
      `Category: **${category.name}** — ${channelCount} channel${channelCount !== 1 ? 's' : ''}\n\nNow pick the **group role** that has access to this category.\n\nThe bot will create \`Shadowed <Role Name>\` and mirror all channels into a private shadow category.`,
    )],
    components: [row],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Role chosen → create shadow infrastructure for this group
// ─────────────────────────────────────────────────────────────────────────────

export async function handleRoleSelect(interaction) {
  await interaction.deferUpdate();

  const categoryId = interaction.customId.split(':')[1];
  const groupRoleId = interaction.values[0];
  const { guild } = interaction;

  try {
    await guild.channels.fetch();
    await guild.roles.fetch();

    const originalCategory = guild.channels.cache.get(categoryId);
    const groupRole = guild.roles.cache.get(groupRoleId);

    if (!originalCategory || !groupRole) {
      return interaction.editReply({
        embeds: [errorEmbed('Not Found', 'The selected category or role no longer exists.')],
        components: [],
      });
    }

    // ── Create or reuse shadow role ──────────────────────────────────────────
    const shadowRoleName = `Shadowed ${groupRole.name}`;
    let shadowRole = guild.roles.cache.find((r) => r.name === shadowRoleName);
    const roleCreated = !shadowRole;

    if (!shadowRole) {
      shadowRole = await guild.roles.create({
        name: shadowRoleName,
        colors: { primaryColor: 0x2c2f33 },
        hoist: false,
        mentionable: false,
        reason: 'Shadowban bot — group shadow role',
      });
      logger.info(`Created shadow role: ${shadowRoleName}`, { guildId: guild.id });
    }

    // ── Create shadow category ───────────────────────────────────────────────
    const shadowCategory = await guild.channels.create({
      name: `🔒 ${originalCategory.name}`,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        copyRoleOverwrite(originalCategory, groupRole.id, shadowRole.id, [PermissionFlagsBits.ViewChannel]),
      ],
      reason: 'Shadowban bot — shadow category',
    });

    // ── Mirror every channel in the category ─────────────────────────────────
    const channels = guild.channels.cache
      .filter((c) => c.parentId === categoryId)
      .sort((a, b) => a.position - b.position);

    const channelMappings = [];

    for (const [, channel] of channels) {
      const shadowChannel = await guild.channels.create({
        name: channel.name.slice(0, 100),
        type: ChannelType.GuildText,
        parent: shadowCategory.id,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          copyRoleOverwrite(channel, groupRole.id, shadowRole.id),
        ],
        topic: `Shadow mirror of #${channel.name}.`,
        reason: 'Shadowban bot — shadow channel',
      });

      channelMappings.push({
        originalChannelId: channel.id,
        shadowChannelId: shadowChannel.id,
        groupRoleId: groupRole.id,
        shadowRoleId: shadowRole.id,
      });
    }

    // ── Create or reuse #mod-queue ───────────────────────────────────────────
    const existingSettings = await getGuildSettings(guild.id);
    let modQueueChannel = existingSettings?.mod_queue_channel_id
      ? await guild.channels.fetch(existingSettings.mod_queue_channel_id).catch(() => null)
      : null;

    const modQueueCreated = !modQueueChannel;

    if (!modQueueChannel) {
      modQueueChannel = await guild.channels.create({
        name: 'mod-queue',
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        ],
        topic: 'Pending shadowban reviews. Use the buttons to Approve, Reject, or Release.',
        reason: 'Shadowban bot — mod queue',
      });
    }

    // ── Upsert mappings — preserves all other groups ─────────────────────────
    await upsertChannelMappings(guild.id, channelMappings);
    await upsertGuildSettings(guild.id, {
      mod_queue_channel_id: modQueueChannel.id,
      enabled: true,
    });

    logger.info('Group setup complete', {
      guildId: guild.id,
      category: originalCategory.name,
      groupRole: groupRole.name,
      shadowRole: shadowRoleName,
      channelCount: channelMappings.length,
      admin: interaction.user.tag,
    });

    const lines = [
      `${EMOJI.SUCCESS} **${originalCategory.name}** → 🔒 ${shadowCategory.name}`,
      `${roleCreated ? EMOJI.SUCCESS + ' Created' : EMOJI.INFO + ' Reused'} shadow role: **${shadowRoleName}**`,
      `${EMOJI.SUCCESS} Mapped **${channelMappings.length}** channel${channelMappings.length !== 1 ? 's' : ''}`,
      `${modQueueCreated ? EMOJI.SUCCESS + ' Created' : EMOJI.INFO + ' Reused'} mod queue: ${modQueueChannel}`,
      '',
      '**Shadowban flow for this group:**',
      `Flagged message → Remove \`${groupRole.name}\` + Add \`${shadowRoleName}\``,
      `Approve / Release → Remove \`${shadowRoleName}\` + Restore \`${groupRole.name}\``,
      '',
      `Run \`/setup\` again to add the next group.`,
    ];

    return interaction.editReply({
      embeds: [successEmbed(`Group Added: ${groupRole.name}`, lines.join('\n'))],
      components: [],
    });

  } catch (err) {
    logger.error('Setup role select failed', { guildId: interaction.guildId, error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('Setup Failed', `Something went wrong: ${err.message}\n\nMake sure the bot has **Administrator** permission.`)],
      components: [],
    });
  }
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
