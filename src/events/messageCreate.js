// src/events/messageCreate.js
// ─────────────────────────────────────────────────────────────────────────────
// Fires on every message. This is the core pipeline:
//   1. Ignore bots, DMs, already-shadowed users
//   2. Check if bot is enabled in this guild
//   3. Classify the message (pre-filter → Claude API)
//   4. If SUSPECT or TOXIC → trigger shadowban flow
// ─────────────────────────────────────────────────────────────────────────────

import { REST, Routes } from 'discord.js';
import { isBotEnabled, getGuildSettings } from '../services/supabase.js';
import { classifyMessage } from '../services/classifierService.js';
import { shadowMessage } from '../services/shadowService.js';
import { CLASSIFICATION } from '../config/constants.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

export const name = 'messageCreate';
export const once = false;

export async function execute(message, client) {
  // ── Ignore bots and DMs ──────────────────────────────────────────────────
  if (message.author.bot || !message.guild) return;

  // ── !sync — register slash commands (admin only, no slash commands needed) ─
  if (message.content.trim() === 'sb!sync') {
    if (!message.member.permissions.has('Administrator')) {
      return message.reply('You need Administrator permission to sync commands.');
    }

    const payload = client.commands.map((cmd) => cmd.data.toJSON());
    const rest = new REST().setToken(config.discord.token);

    try {
      await message.reply(`⏳ Registering ${payload.length} commands to this server...`);
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, message.guildId),
        { body: payload }
      );
      const list = payload.map((c) => `\`/${c.name}\``).join(', ');
      await message.reply(`✅ Done! Registered: ${list}`);
      logger.info(`Commands synced via !sync`, { guildId: message.guildId, user: message.author.tag });
    } catch (err) {
      await message.reply(`❌ Sync failed: ${err.message}`);
      logger.error('!sync failed', { error: err.message });
    }
    return;
  }

  // ── Check bot is enabled for this guild ──────────────────────────────────
  const enabled = await isBotEnabled(message.guildId);
  if (!enabled) return;

  // ── Skip users who are already shadowed ──────────────────────────────────
  // Their messages land in the shadow channel only — no need to re-process them
  const member = message.member;
  if (!member) return;

  // Skip users who have any Shadowed* role — their messages land in shadow channels
  const alreadyShadowed = member.roles.cache.some((r) => r.name.startsWith('Shadowed'));
  if (alreadyShadowed) return;

  // ── Skip messages from users with Manage Messages permission (staff) ──────
  if (member.permissions.has('ManageMessages')) return;

  // ── Classify ──────────────────────────────────────────────────────────────
  const classification = await classifyMessage(message.content);

  if (classification === CLASSIFICATION.SAFE) return;

  // ── Trigger shadowban flow ────────────────────────────────────────────────
  logger.info(`🚨 Triggering shadowban: ${classification} | ${message.author.tag}`, {
    guildId: message.guildId,
  });

  await shadowMessage(message, classification, client);
}
