// src/events/interactionCreate.js
// ─────────────────────────────────────────────────────────────────────────────
// Central interaction router.
//  - Slash commands → find in client.commands and execute
//  - Button interactions → delegated to shadowService (mod queue actions)
//
// Also enforces the guild-level enable/disable toggle for slash commands.
// ─────────────────────────────────────────────────────────────────────────────

import { InteractionType } from 'discord.js';
import { isBotEnabled, upsertGuildSettings } from '../services/supabase.js';
import { handleModQueueButton } from '../services/shadowService.js';
import { disabledEmbed, errorEmbed, successEmbed } from '../utils/embed.js';
import logger from '../utils/logger.js';

export const name = 'interactionCreate';
export const once = false;

export async function execute(interaction, client) {
  // ── Slash commands ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);

    if (!command) {
      logger.warn(`Unknown command: /${interaction.commandName}`);
      return;
    }

    // The /toggle command must always work, even when the bot is disabled,
    // so admins can re-enable it. Skip the enabled check for it.
    const bypassToggle = interaction.commandName === 'toggle';

    if (!bypassToggle) {
      const enabled = await isBotEnabled(interaction.guildId);
      if (!enabled) {
        return interaction.reply({ embeds: [disabledEmbed()], ephemeral: true });
      }
    }

    try {
      await command.execute(interaction, client);
    } catch (err) {
      logger.error(`Command /${interaction.commandName} failed`, {
        guildId: interaction.guildId,
        error: err.message,
      });

      const embed = errorEmbed('Command Error', 'Something went wrong. Please try again.');

      // Reply or follow-up depending on whether we already responded
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [embed], ephemeral: true });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }

    return;
  }

  // ── Modal submissions ───────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'setprompt_modal') {
      await interaction.deferReply({ ephemeral: true });
      const prompt = interaction.fields.getTextInputValue('system_prompt');

      try {
        await upsertGuildSettings(interaction.guildId, { ai_system_prompt: prompt });

        logger.info('AI system prompt updated', {
          guildId: interaction.guildId,
          admin: interaction.user.tag,
          promptLength: prompt.length,
        });

        return interaction.editReply({
          embeds: [
            successEmbed(
              'System Prompt Saved',
              `The AI system prompt has been set (${prompt.length} characters).\nUsers can now use \`/ask\` to chat with Claude.`
            ),
          ],
        });
      } catch (err) {
        logger.error('setprompt modal save failed', { guildId: interaction.guildId, error: err.message });
        return interaction.editReply({
          embeds: [errorEmbed('Save Failed', 'Could not save the prompt. Please try again.')],
        });
      }
    }

    return;
  }

  // ── Button interactions (mod queue: Approve / Reject / Release) ─────────────
  if (interaction.isButton()) {
    // Button custom IDs are prefixed with "shadowban_" — ignore anything else
    if (!interaction.customId.startsWith('shadowban_')) return;

    try {
      await handleModQueueButton(interaction);
    } catch (err) {
      logger.error('Mod queue button handler failed', {
        guildId: interaction.guildId,
        customId: interaction.customId,
        error: err.message,
      });

      const embed = errorEmbed('Action Failed', 'Could not process this action. Check bot permissions.');
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [embed], ephemeral: true });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }
}
