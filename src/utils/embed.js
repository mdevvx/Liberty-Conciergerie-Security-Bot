// src/utils/embed.js
// ─────────────────────────────────────────────────────────────────────────────
// Reusable embed builders. Using helpers here keeps command files clean and
// ensures all embeds share a consistent look and feel across the bot.
// ─────────────────────────────────────────────────────────────────────────────

import { EmbedBuilder } from 'discord.js';
import { COLORS, EMOJI } from '../config/constants.js';

// ── Generic response embeds ───────────────────────────────────────────────────

export function successEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${EMOJI.SUCCESS} ${title}`)
    .setDescription(description)
    .setTimestamp();
}

export function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.ERROR)
    .setTitle(`${EMOJI.ERROR} ${title}`)
    .setDescription(description)
    .setTimestamp();
}

export function warningEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle(`${EMOJI.WARNING} ${title}`)
    .setDescription(description)
    .setTimestamp();
}

export function infoEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(`${EMOJI.INFO} ${title}`)
    .setDescription(description)
    .setTimestamp();
}

// ── Bot disabled embed ────────────────────────────────────────────────────────
// Shown in every command when the bot is toggled off for a guild

export function disabledEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.NEUTRAL)
    .setTitle(`${EMOJI.TOGGLE_OFF} Bot Disabled`)
    .setDescription('The shadowban bot is currently **disabled** in this server.\nAn admin can re-enable it with `/toggle`.')
    .setTimestamp();
}

// ── Mod queue embed ───────────────────────────────────────────────────────────
// Used when a suspicious message is posted to the mod queue channel

export function modQueueEmbed({ authorTag, authorId, content, channelName, classification, messageId }) {
  return new EmbedBuilder()
    .setColor(COLORS.SHADOW)
    .setTitle(`${EMOJI.SHADOW} Shadowban Queue — ${classification}`)
    .setDescription(`> ${content}`)
    .addFields(
      { name: '👤 Author', value: `<@${authorId}> (${authorTag})`, inline: true },
      { name: '📢 Channel', value: `#${channelName}`, inline: true },
      { name: '🆔 Message ID', value: messageId, inline: false },
    )
    .setFooter({ text: 'Use the buttons below to take action' })
    .setTimestamp();
}
