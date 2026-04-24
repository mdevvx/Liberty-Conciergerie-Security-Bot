// src/services/supabase.js
// ─────────────────────────────────────────────────────────────────────────────
// Supabase client + all database operations.
// Every DB call in the bot goes through this file — keeps SQL/queries
// centralised and easy to debug or swap out later.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

// ── Initialise client ─────────────────────────────────────────────────────────
const supabase = createClient(config.supabase.url, config.supabase.anonKey);

export default supabase;

// ─────────────────────────────────────────────────────────────────────────────
// GUILD SETTINGS
// Stores per-guild config: enabled/disabled state, mod queue channel, etc.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get settings for a guild. Returns null if the guild has no row yet.
 * @param {string} guildId
 */
export async function getGuildSettings(guildId) {
  const { data, error } = await supabase
    .from('shadowban_guild_settings')
    .select('*')
    .eq('guild_id', guildId)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = "no rows found" — that's fine, everything else is a real error
    logger.error('getGuildSettings failed', { guildId, error: error.message });
  }

  return data ?? null;
}

/**
 * Upsert guild settings. Creates the row if it doesn't exist.
 * @param {string} guildId
 * @param {object} updates  — partial object with columns to set
 */
export async function upsertGuildSettings(guildId, updates) {
  const { data, error } = await supabase
    .from('shadowban_guild_settings')
    .upsert({ guild_id: guildId, ...updates }, { onConflict: 'guild_id' })
    .select()
    .single();

  if (error) {
    logger.error('upsertGuildSettings failed', { guildId, error: error.message });
    throw error;
  }

  return data;
}

/**
 * Get the AI system prompt for a guild. Returns null if not set.
 * @param {string} guildId
 * @returns {Promise<string|null>}
 */
export async function getAiSystemPrompt(guildId) {
  const settings = await getGuildSettings(guildId);
  return settings?.ai_system_prompt ?? null;
}

/**
 * Check whether the bot is enabled for a guild.
 * Defaults to TRUE if the guild has no settings row yet (first-run behaviour).
 * @param {string} guildId
 * @returns {boolean}
 */
export async function isBotEnabled(guildId) {
  const settings = await getGuildSettings(guildId);
  // No row = bot has never been toggled, treat as enabled
  return settings ? settings.enabled : true;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW MESSAGES
// Tracks the original → shadow → public message ID chain + mod decisions.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a new shadow message record when a message is intercepted.
 * @param {object} params
 */
export async function createShadowMessage({
  guildId,
  originalId,
  shadowId,
  authorId,
  authorTag,
  content,
  channelId,
  channelName,
  classification,
}) {
  const { data, error } = await supabase
    .from('shadowban_messages')
    .insert({
      guild_id: guildId,
      original_id: originalId,
      shadow_id: shadowId,
      author_id: authorId,
      author_tag: authorTag,
      content,
      channel_id: channelId,
      channel_name: channelName,
      classification,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    logger.error('createShadowMessage failed', { guildId, error: error.message });
    throw error;
  }

  return data;
}

/**
 * Find a shadow message record by its shadow channel message ID.
 * Used when a mod clicks Approve/Reject/Release.
 * @param {string} shadowId
 */
export async function getShadowMessageByShadowId(shadowId) {
  const { data, error } = await supabase
    .from('shadowban_messages')
    .select('*')
    .eq('shadow_id', shadowId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('getShadowMessageByShadowId failed', { shadowId, error: error.message });
  }

  return data ?? null;
}

/**
 * Update the status of a shadow message and optionally store the public repost ID.
 * @param {string} shadowId
 * @param {string} status        — 'approved' | 'rejected' | 'released'
 * @param {string} [publicId]    — Discord message ID of the public repost (approve only)
 * @param {string} [modId]       — Discord user ID of the moderator who acted
 */
export async function updateShadowMessageStatus(shadowId, status, publicId = null, modId = null) {
  const { data, error } = await supabase
    .from('shadowban_messages')
    .update({
      status,
      public_id: publicId,
      mod_id: modId,
      resolved_at: new Date().toISOString(),
    })
    .eq('shadow_id', shadowId)
    .select()
    .single();

  if (error) {
    logger.error('updateShadowMessageStatus failed', { shadowId, error: error.message });
    throw error;
  }

  return data;
}
