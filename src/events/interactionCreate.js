// src/events/interactionCreate.js
// ─────────────────────────────────────────────────────────────────────────────
// Central interaction router.
//  - Slash commands → find in client.commands and execute
//  - Button interactions → delegated to shadowService (mod queue actions)
//
// Also enforces the guild-level enable/disable toggle for slash commands.
// ─────────────────────────────────────────────────────────────────────────────

import { MessageFlags } from 'discord.js';
import { isBotEnabled } from '../services/supabase.js';
import { handleModQueueButton } from '../services/shadowService.js';
import { handleCategorySelect, handleRoleSelect } from '../commands/admin/setup.js';
import { handleAuditFix } from '../commands/admin/audit.js';
import { disabledEmbed, errorEmbed } from '../utils/embed.js';
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
    const bypassToggle = ['toggle', 'setup', 'audit', 'sync', 'setprompt'].includes(interaction.commandName);

    if (!bypassToggle) {
      const enabled = await isBotEnabled(interaction.guildId);
      if (!enabled) {
        return interaction.reply({ embeds: [disabledEmbed()], flags: MessageFlags.Ephemeral });
      }
    }

    try {
      await command.execute(interaction, client);
    } catch (err) {
      logger.error(`Command /${interaction.commandName} failed`, {
        guildId: interaction.guildId,
        error: err.message,
      });
      if (isExpiredInteractionError(err)) return;

      const embed = errorEmbed('Command Error', 'Something went wrong. Please try again.');

      // Reply or follow-up depending on whether we already responded
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    }

    return;
  }

  // ── String select menu (setup: category selection) ──────────────────────────
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'setup_cat_select') {
      try {
        await handleCategorySelect(interaction);
      } catch (err) {
        logger.error('Setup category select handler failed', {
          guildId: interaction.guildId,
          error: err.message,
        });
        const embed = errorEmbed('Setup Failed', 'Something went wrong during setup. Check bot permissions and try again.');
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
      }
    }
    return;
  }

  // ── Role select menu (setup: role selection) ────────────────────────────────
  if (interaction.isRoleSelectMenu()) {
    if (interaction.customId.startsWith('setup_role_select:')) {
      try {
        await handleRoleSelect(interaction);
      } catch (err) {
        logger.error('Setup role select handler failed', {
          guildId: interaction.guildId,
          error: err.message,
        });
        const embed = errorEmbed('Setup Failed', 'Something went wrong during setup. Check bot permissions and try again.');
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
      }
    }
    return;
  }

  // ── Button interactions ──────────────────────────────────────────────────────
  if (interaction.isButton()) {
    // Audit fix button
    if (interaction.customId === 'audit_fix') {
      try {
        await handleAuditFix(interaction);
      } catch (err) {
        logger.error('Audit fix handler failed', {
          guildId: interaction.guildId,
          error: err.message,
        });
        const embed = errorEmbed('Fix Failed', 'Something went wrong. Check bot permissions and try again.');
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
      }
      return;
    }

    // Mod queue buttons: Approve / Reject / Release
    if (interaction.customId.startsWith('shadowban_')) {
      try {
        await handleModQueueButton(interaction);
      } catch (err) {
        logger.error('Mod queue button handler failed', {
          guildId: interaction.guildId,
          customId: interaction.customId,
          error: err.message,
        });
        if (isExpiredInteractionError(err)) return;

        const embed = errorEmbed('Action Failed', 'Could not process this action. Check bot permissions.');
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
      }
    }
  }
}

function isExpiredInteractionError(err) {
  const codes = [err?.code, err?.rawError?.code].map((code) => Number(code));
  return codes.includes(10062) || codes.includes(40060);
}
