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

// 60-second TTL cache — avoids a DB round-trip before every slash command
const _enabledCache = new Map(); // guildId → { value: boolean, until: number }

/**
 * Check whether the bot is enabled for a guild.
 * Defaults to TRUE if the guild has no settings row yet (first-run behaviour).
 * Result is cached for 60 s; call invalidateBotEnabledCache() after toggling.
 * @param {string} guildId
 * @returns {Promise<boolean>}
 */
export async function isBotEnabled(guildId) {
  const hit = _enabledCache.get(guildId);
  if (hit && Date.now() < hit.until) return hit.value;

  const settings = await getGuildSettings(guildId);
  const value = settings ? settings.enabled : true;
  _enabledCache.set(guildId, { value, until: Date.now() + 60_000 });
  return value;
}

/**
 * Bust the isBotEnabled cache for a guild.
 * Must be called after /toggle writes a new state.
 * @param {string} guildId
 */
export function invalidateBotEnabledCache(guildId) {
  _enabledCache.delete(guildId);
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
  groupRoleId,
  shadowRoleId,
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
      group_role_id: groupRoleId ?? null,
      shadow_role_id: shadowRoleId ?? null,
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

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MAPPINGS
// Maps original channel IDs → their shadow channel counterparts.
// Table: shadowban_channel_map (guild_id, original_channel_id, shadow_channel_id,
//                               group_role_id, shadow_role_id)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all channel mappings for a guild in one query.
 * Used by the audit command to avoid per-channel DB calls.
 * @param {string} guildId
 * @returns {Promise<object[]>}
 */
export async function getChannelMappingsForGuild(guildId) {
  const { data, error } = await supabase
    .from('shadowban_channel_map')
    .select('*')
    .eq('guild_id', guildId);

  if (error) {
    logger.error('getChannelMappingsForGuild failed', { guildId, error: error.message });
    return [];
  }

  return data ?? [];
}

/**
 * Delete all channel mappings for a guild. Called on re-setup so stale entries
 * don't accumulate.
 * @param {string} guildId
 */
export async function clearChannelMappings(guildId) {
  const { error } = await supabase
    .from('shadowban_channel_map')
    .delete()
    .eq('guild_id', guildId);

  if (error) {
    logger.error('clearChannelMappings failed', { guildId, error: error.message });
    throw error;
  }
}

/**
 * Bulk-upsert channel mappings after setup.
 * @param {string} guildId
 * @param {{ originalChannelId: string, shadowChannelId: string, groupRoleId: string|null, shadowRoleId: string|null }[]} mappings
 */
export async function upsertChannelMappings(guildId, mappings) {
  if (mappings.length === 0) return;

  const rows = mappings.map(({ originalChannelId, shadowChannelId, groupRoleId, shadowRoleId }) => ({
    guild_id: guildId,
    original_channel_id: originalChannelId,
    shadow_channel_id: shadowChannelId,
    group_role_id: groupRoleId ?? null,
    shadow_role_id: shadowRoleId ?? null,
  }));

  const { error } = await supabase
    .from('shadowban_channel_map')
    .upsert(rows, { onConflict: 'guild_id,original_channel_id' });

  if (error) {
    logger.error('upsertChannelMappings failed', { guildId, error: error.message });
    throw error;
  }
}

/**
 * Look up routing info for a source channel.
 * Returns null if the channel has no shadow mapping.
 * @param {string} guildId
 * @param {string} originalChannelId
 * @returns {Promise<{ shadowChannelId: string, groupRoleId: string|null, shadowRoleId: string|null }|null>}
 */
export async function getShadowChannelFor(guildId, originalChannelId) {
  const { data, error } = await supabase
    .from('shadowban_channel_map')
    .select('shadow_channel_id, group_role_id, shadow_role_id')
    .eq('guild_id', guildId)
    .eq('original_channel_id', originalChannelId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('getShadowChannelFor failed', { guildId, originalChannelId, error: error.message });
  }

  if (!data) return null;

  return {
    shadowChannelId: data.shadow_channel_id,
    groupRoleId: data.group_role_id,
    shadowRoleId: data.shadow_role_id,
  };
}

/**
 * Get all unique (group_role_id, shadow_role_id) pairs configured for a guild.
 * Used by manual shadowban/unshadowban to find which roles to swap.
 * @param {string} guildId
 * @returns {Promise<{ group_role_id: string, shadow_role_id: string }[]>}
 */
export async function getRoleMappingsForGuild(guildId) {
  const { data, error } = await supabase
    .from('shadowban_channel_map')
    .select('group_role_id, shadow_role_id')
    .eq('guild_id', guildId)
    .not('group_role_id', 'is', null);

  if (error) {
    logger.error('getRoleMappingsForGuild failed', { guildId, error: error.message });
    return [];
  }

  // Deduplicate — many channels share the same role pair
  const seen = new Set();
  return (data ?? []).filter(({ group_role_id, shadow_role_id }) => {
    const key = `${group_role_id}:${shadow_role_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
