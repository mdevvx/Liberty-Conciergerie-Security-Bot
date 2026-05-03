// src/services/shadowService.js
// ─────────────────────────────────────────────────────────────────────────────
// Core shadowban logic:
//   shadowMessage()         — intercepts a message, deletes it, reposts in the
//                             group-specific shadow channel, pushes to mod queue
//   handleModQueueButton()  — handles Approve / Reject / Release button clicks
//
// Per-group role flow:
//   Shadowban  → remove Group N role  + add Shadowed N role
//   Approve    → repost publicly + remove Shadowed N role + add Group N role
//   Release    → remove Shadowed N role + add Group N role (no repost)
//   Reject     → keep Shadowed N role (user stays invisible in their group)
// ─────────────────────────────────────────────────────────────────────────────

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    WebhookClient,
} from "discord.js";
import {
    createShadowMessage,
    getShadowMessageByShadowId,
    updateShadowMessageStatus,
    getGuildSettings,
    getShadowChannelFor,
} from "./supabase.js";
import { modQueueEmbed, successEmbed, errorEmbed } from "../utils/embed.js";
import { SHADOW_STATUS, EMOJI, CLASSIFICATION, COLORS } from "../config/constants.js";
import logger from "../utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW MESSAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full shadowban flow for a single message:
 *  1. Delete original message
 *  2. Resolve routing: shadow channel + group/shadow role IDs for this channel
 *  3. Swap roles: remove group role, add shadow role
 *  4. Repost in the group-specific shadow channel via webhook
 *  5. Save to DB (with role IDs for later restore)
 *  6. Push to mod queue (SUSPECT only)
 *
 * @param {import('discord.js').Message} message
 * @param {string} classification — SUSPECT | TOXIC
 * @param {import('discord.js').Client} client
 */
export async function shadowMessage(message, classification, client) {
    const { guild, author, channel, content } = message;

    // ── Step 1: Resolve routing ───────────────────────────────────────────────
    const [routing, settings] = await Promise.all([
        getShadowChannelFor(guild.id, channel.id),
        getGuildSettings(guild.id),
    ]);

    if (!routing) {
        logger.info("Channel has no shadow mapping — not monitored, skipping", {
            guildId: guild.id,
            channelId: channel.id,
        });
        return;
    }

    if (!settings?.mod_queue_channel_id) {
        logger.warn("Guild missing mod_queue_channel_id — skipping shadowban", {
            guildId: guild.id,
        });
        return;
    }

    // ── Step 2: Delete the original message ───────────────────────────────────
    try {
        await message.delete();
        logger.info(`🗑️  Deleted message ${message.id}`, { guildId: guild.id });
    } catch (err) {
        logger.error("Failed to delete original message", {
            guildId: guild.id,
            error: err.message,
        });
        return;
    }

    const { shadowChannelId, groupRoleId, shadowRoleId } = routing;

    // ── Step 3: Swap group role → shadow role ─────────────────────────────────
    try {
        const member = await guild.members.fetch(author.id);

        if (groupRoleId) {
            const groupRole = guild.roles.cache.get(groupRoleId);
            if (groupRole && member.roles.cache.has(groupRole.id)) {
                await member.roles.remove(
                    groupRole,
                    `Shadowban: ${classification}`,
                );
                logger.info(
                    `Removed group role ${groupRole.name} from ${author.tag}`,
                    { guildId: guild.id },
                );
            }
        }

        if (shadowRoleId) {
            const shadowRole = guild.roles.cache.get(shadowRoleId);
            if (shadowRole) {
                await member.roles.add(
                    shadowRole,
                    `Shadowban: ${classification}`,
                );
                logger.info(
                    `Added shadow role ${shadowRole.name} to ${author.tag}`,
                    { guildId: guild.id },
                );
            }
        }
    } catch (err) {
        logger.error("Failed to swap group/shadow roles", {
            guildId: guild.id,
            error: err.message,
        });
    }

    // ── Step 4: Repost in shadow channel ─────────────────────────────────────
    let shadowMessageId = null;

    let shadowChannel;
    try {
        shadowChannel = await guild.channels.fetch(shadowChannelId);
    } catch (err) {
        logger.error("Failed to fetch shadow channel", {
            guildId: guild.id,
            shadowChannelId,
            error: err.message,
        });
        return;
    }

    let webhook;
    try {
        webhook = await getOrCreateWebhook(shadowChannel, client);
    } catch (err) {
        logger.error("Failed to get/create webhook", {
            guildId: guild.id,
            shadowChannelId,
            error: err.message,
        });
        return;
    }

    try {
        const payload = buildRepostPayload({
            content,
            user: author,
            member: message.member,
        });
        const webhookClient = new WebhookClient({ url: webhook.url });
        const shadowMsg = await webhookClient.send(payload);
        shadowMessageId = shadowMsg.id;
        logger.info(`👁️  Reposted in shadow channel: ${shadowMessageId}`, {
            guildId: guild.id,
        });
    } catch (err) {
        logger.error("Failed to send via webhook", {
            guildId: guild.id,
            webhookId: webhook.id,
            error: err.message,
            code: err.code,
        });
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
            groupRoleId,
            shadowRoleId,
        });
    } catch (err) {
        logger.error("Failed to save shadow message to DB", {
            guildId: guild.id,
            error: err.message,
        });
        return;
    }

    // ── Step 6: Post to mod queue (SUSPECT only) ──────────────────────────────
    if (classification === CLASSIFICATION.TOXIC) {
        logger.info(`🔇 TOXIC — silent shadowban, skipping mod queue`, {
            guildId: guild.id,
            shadowId: shadowMessageId,
        });
        return;
    }

    try {
        const modQueueChannel = await guild.channels.fetch(
            settings.mod_queue_channel_id,
        );

        const embed = modQueueEmbed({
            authorTag: author.tag,
            authorId: author.id,
            content,
            channelName: channel,
            classification,
            messageId: message.id,
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`shadowban_approve_${shadowMessageId}`)
                .setLabel("Approve")
                .setEmoji(EMOJI.APPROVE)
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`shadowban_reject_${shadowMessageId}`)
                .setLabel("Reject")
                .setEmoji(EMOJI.REJECT)
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`shadowban_release_${shadowMessageId}`)
                .setLabel("Release")
                .setEmoji(EMOJI.RELEASE)
                .setStyle(ButtonStyle.Secondary),
        );

        await modQueueChannel.send({ embeds: [embed], components: [row] });
        logger.info(`📋 Pushed to mod queue`, {
            guildId: guild.id,
            shadowId: shadowMessageId,
        });
    } catch (err) {
        logger.error("Failed to post to mod queue", {
            guildId: guild.id,
            error: err.message,
        });
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

    const parts = interaction.customId.split("_");
    const action = parts[1];
    const shadowId = parts.slice(2).join("_");

    const record = await getShadowMessageByShadowId(shadowId);

    if (!record) {
        return interaction.editReply({
            embeds: [
                errorEmbed(
                    "Not Found",
                    "Could not find this message in the database.",
                ),
            ],
        });
    }

    if (record.status !== SHADOW_STATUS.PENDING) {
        return interaction.editReply({
            embeds: [
                errorEmbed(
                    "Already Actioned",
                    `This message was already **${record.status}**.`,
                ),
            ],
        });
    }

    const guild = interaction.guild;
    const settings = await getGuildSettings(guild.id);

    // ── Approve: repost publicly + restore group role ─────────────────────────
    if (action === "approve") {
        let publicId = null;

        try {
            const publicChannel = await guild.channels.fetch(record.channel_id);
            const webhook = await getOrCreateWebhook(
                publicChannel,
                interaction.client,
            );

            const member = await guild.members.fetch(record.author_id);
            const payload = buildRepostPayload({
                content: record.content,
                user: member.user,
                member,
                fallbackName: record.author_tag.split("#")[0],
            });
            const webhookClient = new WebhookClient({ url: webhook.url });
            const publicMsg = await webhookClient.send(payload);
            publicId = publicMsg.id;
            logger.info(`👁️  Reposted in public channel: ${publicId}`, {
                guildId: guild.id,
            });
        } catch (err) {
            logger.error("Approve: failed to repost publicly", {
                error: err.message,
                code: err.code,
            });
        }

        await restoreGroupRoles(
            guild,
            record.author_id,
            record.shadow_role_id,
            record.group_role_id,
        );
        await updateShadowMessageStatus(
            shadowId,
            SHADOW_STATUS.APPROVED,
            publicId,
            interaction.user.id,
        );
        await disableQueueButtons(interaction, "approve", interaction.user);

        return interaction.editReply({
            embeds: [
                successEmbed(
                    "Approved",
                    `Message approved and reposted in <#${record.channel_id}>.`,
                ),
            ],
        });
    }

    // ── Reject: keep in shadow, author stays invisible ────────────────────────
    if (action === "reject") {
        await updateShadowMessageStatus(
            shadowId,
            SHADOW_STATUS.REJECTED,
            null,
            interaction.user.id,
        );
        await disableQueueButtons(interaction, "reject", interaction.user);

        return interaction.editReply({
            embeds: [
                successEmbed(
                    "Rejected",
                    "Message rejected. User remains in shadow.",
                ),
            ],
        });
    }

    // ── Release: restore group role but don't repost ──────────────────────────
    if (action === "release") {
        await restoreGroupRoles(
            guild,
            record.author_id,
            record.shadow_role_id,
            record.group_role_id,
        );
        await updateShadowMessageStatus(
            shadowId,
            SHADOW_STATUS.RELEASED,
            null,
            interaction.user.id,
        );
        await disableQueueButtons(interaction, "release", interaction.user);

        return interaction.editReply({
            embeds: [
                successEmbed(
                    "Released",
                    `<@${record.author_id}> restored to their group. Message not reposted.`,
                ),
            ],
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function buildRepostPayload({
    content,
    user,
    member = null,
    fallbackName = null,
}) {
    return {
        content,
        username:
            member?.displayName ||
            user?.globalName ||
            user?.username ||
            fallbackName,
        avatarURL: user?.displayAvatarURL({ size: 256 }),
    };
}


async function getOrCreateWebhook(channel, client) {
    const webhooks = await channel.fetchWebhooks();
    // channelId guard: fetchWebhooks() may return orphaned webhooks from
    // previously-deleted shadow channels when the guild endpoint is used internally
    const existing = webhooks.find(
        (w) =>
            w.owner?.id === client.user.id &&
            w.token &&
            w.channelId === channel.id,
    );

    if (existing) return existing;

    return channel.createWebhook({
        name: "ShadowBot",
        reason: "Shadowban bot — auto-created webhook",
    });
}

/**
 * Remove the shadow role and restore the original group role for a user.
 * Called on Approve and Release actions.
 */
async function restoreGroupRoles(guild, userId, shadowRoleId, groupRoleId) {
    try {
        const member = await guild.members.fetch(userId);

        if (shadowRoleId) {
            const shadowRole = guild.roles.cache.get(shadowRoleId);
            if (shadowRole && member.roles.cache.has(shadowRole.id)) {
                await member.roles.remove(
                    shadowRole,
                    "Shadowban resolved by mod",
                );
                logger.info(
                    `Removed shadow role ${shadowRole.name} from ${userId}`,
                    { guildId: guild.id },
                );
            }
        }

        if (groupRoleId) {
            const groupRole = guild.roles.cache.get(groupRoleId);
            if (groupRole && !member.roles.cache.has(groupRole.id)) {
                await member.roles.add(
                    groupRole,
                    "Shadowban resolved — group role restored",
                );
                logger.info(
                    `Restored group role ${groupRole.name} to ${userId}`,
                    { guildId: guild.id },
                );
            }
        }
    } catch (err) {
        logger.error("Failed to restore group roles", {
            guildId: guild.id,
            userId,
            error: err.message,
        });
    }
}

async function disableQueueButtons(interaction, action, moderator) {
    try {
        const disabledRow = ActionRowBuilder.from(
            interaction.message.components[0],
        );
        disabledRow.components.forEach((btn) => btn.setDisabled(true));

        const statusMap = {
            approve: { label: `${EMOJI.APPROVE} Approved`, color: COLORS.SUCCESS },
            reject:  { label: `${EMOJI.REJECT} Rejected`,  color: COLORS.ERROR },
            release: { label: `${EMOJI.RELEASE} Released`, color: COLORS.NEUTRAL },
        };
        const { label, color } = statusMap[action];

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(color)
            .setFooter({ text: "Action taken" })
            .addFields(
                { name: "📋 Status",          value: label,                                       inline: true },
                { name: `${EMOJI.MOD} Actioned By`, value: `<@${moderator.id}> (${moderator.tag})`, inline: true },
            );

        await interaction.message.edit({ embeds: [updatedEmbed], components: [disabledRow] });
    } catch (err) {
        logger.warn("Could not update queue message", { error: err.message });
    }
}
