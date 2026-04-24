// src/services/shadowService.js
// ─────────────────────────────────────────────────────────────────────────────
// Core shadowban logic:
//   shadowMessage()         — intercepts a message, deletes it, reposts in shadow
//                             channel, pushes to mod queue
//   handleModQueueButton()  — handles Approve / Reject / Release button clicks
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  WebhookClient,
} from 'discord.js';
import {
  createShadowMessage,
  getShadowMessageByShadowId,
  updateShadowMessageStatus,
  getGuildSettings,
} from './supabase.js';
import { modQueueEmbed, successEmbed, errorEmbed } from '../utils/embed.js';
import { TIMING, SHADOW_STATUS, EMOJI, CLASSIFICATION } from '../config/constants.js';
import logger from '../utils/logger.js';

// ── Shadow role name used across all guilds ───────────────────────────────────
const SHADOW_ROLE_NAME = 'Shadowed';

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW MESSAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full shadowban flow for a single message:
 *  1. Delete original message (within TIMING.DELETE_WINDOW_MS)
 *  2. Assign the Shadow role to the author
 *  3. Repost message in the shadow channel via webhook (looks identical to author)
 *  4. Push to mod queue channel with action buttons
 *
 * @param {import('discord.js').Message} message
 * @param {string} classification — SUSPECT | TOXIC
 * @param {import('discord.js').Client} client
 */
export async function shadowMessage(message, classification, client) {
  const { guild, author, channel, content } = message;

  try {
    // ── Step 1: Delete the original message ASAP ──────────────────────────────
    await message.delete();
    logger.info(`🗑️  Deleted message ${message.id}`, { guildId: guild.id });

  } catch (err) {
    // If we can't delete (already gone, no permission), abort — don't shadowban
    logger.error('Failed to delete original message', { guildId: guild.id, error: err.message });
    return;
  }

  // ── Step 2: Get guild settings (shadow channel + mod queue channel) ─────────
  const settings = await getGuildSettings(guild.id);

  if (!settings?.shadow_channel_id || !settings?.mod_queue_channel_id) {
    logger.warn('Guild missing shadow_channel_id or mod_queue_channel_id — skipping shadowban', {
      guildId: guild.id,
    });
    return;
  }

  // ── Step 3: Assign the Shadow role to the author ──────────────────────────
  try {
    const member = await guild.members.fetch(author.id);
    let shadowRole = guild.roles.cache.find((r) => r.name === SHADOW_ROLE_NAME);

    if (!shadowRole) {
      // Create the role if it doesn't exist yet
      shadowRole = await guild.roles.create({
        name: SHADOW_ROLE_NAME,
        colors: { primaryColor: 0x2c2f33 },
        reason: 'Shadowban bot — auto-created Shadow role',
      });
      logger.info(`🛡️  Created Shadow role in ${guild.name}`);
    }

    await member.roles.add(shadowRole, `Shadowban: ${classification}`);
    logger.info(`👤 Assigned Shadow role to ${author.tag}`, { guildId: guild.id });

  } catch (err) {
    logger.error('Failed to assign Shadow role', { guildId: guild.id, error: err.message });
  }

  // ── Step 4: Repost in shadow channel via webhook ──────────────────────────
  let shadowMessageId = null;

  try {
    const shadowChannel = await guild.channels.fetch(settings.shadow_channel_id);

    // Get or create a webhook for this channel
    const webhook = await getOrCreateWebhook(shadowChannel, client);
    const webhookClient = new WebhookClient({ id: webhook.id, token: webhook.token });

    const shadowMsg = await webhookClient.send({
      content,
      username: capitalize(author.username),
      avatarURL: author.displayAvatarURL(),
    });

    shadowMessageId = shadowMsg.id;
    logger.info(`👁️  Reposted in shadow channel: ${shadowMsg.id}`, { guildId: guild.id });

  } catch (err) {
    logger.error('Failed to repost in shadow channel', { guildId: guild.id, error: err.message });
    return;
  }

  // ── Step 5: Save to DB ────────────────────────────────────────────────────
  let record;
  try {
    record = await createShadowMessage({
      guildId: guild.id,
      originalId: message.id,
      shadowId: shadowMessageId,
      authorId: author.id,
      authorTag: author.tag,
      content,
      channelId: channel.id,
      channelName: channel.name,
      classification,
    });
  } catch (err) {
    logger.error('Failed to save shadow message to DB', { guildId: guild.id, error: err.message });
    return;
  }

  // ── Step 6: Post to mod queue (SUSPECT only — TOXIC is silently shadowbanned) ─
  if (classification === CLASSIFICATION.TOXIC) {
    logger.info(`🔇 TOXIC — silent shadowban, skipping mod queue`, { guildId: guild.id, shadowId: shadowMessageId });
    return;
  }

  try {
    const modQueueChannel = await guild.channels.fetch(settings.mod_queue_channel_id);

    const embed = modQueueEmbed({
      authorTag: author.tag,
      authorId: author.id,
      content,
      channelName: channel.name,
      classification,
      messageId: message.id,
    });

    // Button custom IDs include the shadow message ID so we can look it up on click
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`shadowban_approve_${shadowMessageId}`)
        .setLabel('Approve')
        .setEmoji(EMOJI.APPROVE)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`shadowban_reject_${shadowMessageId}`)
        .setLabel('Reject')
        .setEmoji(EMOJI.REJECT)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`shadowban_release_${shadowMessageId}`)
        .setLabel('Release')
        .setEmoji(EMOJI.RELEASE)
        .setStyle(ButtonStyle.Secondary),
    );

    await modQueueChannel.send({ embeds: [embed], components: [row] });
    logger.info(`📋 Pushed to mod queue`, { guildId: guild.id, shadowId: shadowMessageId });

  } catch (err) {
    logger.error('Failed to post to mod queue', { guildId: guild.id, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOD QUEUE BUTTON HANDLER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle Approve / Reject / Release button clicks from the mod queue.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleModQueueButton(interaction) {
  await interaction.deferReply({ ephemeral: true });

  // Parse action and shadowId from the custom ID: "shadowban_<action>_<shadowId>"
  const parts = interaction.customId.split('_');
  const action = parts[1];           // approve | reject | release
  const shadowId = parts.slice(2).join('_');  // the message ID

  // Look up the record in DB
  const record = await getShadowMessageByShadowId(shadowId);

  if (!record) {
    return interaction.editReply({
      embeds: [errorEmbed('Not Found', 'Could not find this message in the database.')],
    });
  }

  if (record.status !== SHADOW_STATUS.PENDING) {
    return interaction.editReply({
      embeds: [errorEmbed('Already Actioned', `This message was already **${record.status}**.`)],
    });
  }

  const guild = interaction.guild;
  const settings = await getGuildSettings(guild.id);

  // ── Approve: repost publicly + remove Shadow role ─────────────────────────
  if (action === 'approve') {
    let publicId = null;

    try {
      const publicChannel = await guild.channels.fetch(record.channel_id);
      const webhook = await getOrCreateWebhook(publicChannel, interaction.client);
      const webhookClient = new WebhookClient({ id: webhook.id, token: webhook.token });

      const publicMsg = await webhookClient.send({
        content: record.content,
        username: capitalize(record.author_tag.split('#')[0]),
        avatarURL: (await guild.members.fetch(record.author_id))
          .user.displayAvatarURL(),
      });

      publicId = publicMsg.id;
    } catch (err) {
      logger.error('Approve: failed to repost publicly', { error: err.message });
    }

    // Remove Shadow role
    await removeShadowRole(guild, record.author_id);
    await updateShadowMessageStatus(shadowId, SHADOW_STATUS.APPROVED, publicId, interaction.user.id);

    // Update the queue embed to show it's been handled
    await disableQueueButtons(interaction);

    return interaction.editReply({
      embeds: [successEmbed('Approved', `Message approved and reposted in <#${record.channel_id}>.`)],
    });
  }

  // ── Reject: keep in shadow, author never knows ────────────────────────────
  if (action === 'reject') {
    await updateShadowMessageStatus(shadowId, SHADOW_STATUS.REJECTED, null, interaction.user.id);
    await disableQueueButtons(interaction);

    return interaction.editReply({
      embeds: [successEmbed('Rejected', 'Message rejected. It remains visible only to the author.')],
    });
  }

  // ── Release: remove Shadow role but don't repost ──────────────────────────
  if (action === 'release') {
    await removeShadowRole(guild, record.author_id);
    await updateShadowMessageStatus(shadowId, SHADOW_STATUS.RELEASED, null, interaction.user.id);
    await disableQueueButtons(interaction);

    return interaction.editReply({
      embeds: [successEmbed('Released', `Shadow role removed from <@${record.author_id}>. Message not reposted.`)],
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function capitalize(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Get the first bot-owned webhook in a channel, or create one if none exists.
 * @param {import('discord.js').TextChannel} channel
 * @param {import('discord.js').Client} client
 */
async function getOrCreateWebhook(channel, client) {
  const webhooks = await channel.fetchWebhooks();
  const existing = webhooks.find((w) => w.owner?.id === client.user.id);

  if (existing) return existing;

  return channel.createWebhook({
    name: 'ShadowBot',
    reason: 'Shadowban bot — auto-created webhook',
  });
}

/**
 * Remove the Shadow role from a guild member if they have it.
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 */
async function removeShadowRole(guild, userId) {
  try {
    const member = await guild.members.fetch(userId);
    const shadowRole = guild.roles.cache.find((r) => r.name === SHADOW_ROLE_NAME);
    if (shadowRole && member.roles.cache.has(shadowRole.id)) {
      await member.roles.remove(shadowRole, 'Shadowban resolved by mod');
    }
  } catch (err) {
    logger.error('Failed to remove Shadow role', { guildId: guild.id, userId, error: err.message });
  }
}

/**
 * Edit the original mod queue message to disable its buttons after action is taken.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function disableQueueButtons(interaction) {
  try {
    const disabledRow = ActionRowBuilder.from(interaction.message.components[0]);
    disabledRow.components.forEach((btn) => btn.setDisabled(true));
    await interaction.message.edit({ components: [disabledRow] });
  } catch (err) {
    logger.warn('Could not disable queue buttons', { error: err.message });
  }
}
