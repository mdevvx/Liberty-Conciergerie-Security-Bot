// src/commands/admin/setprompt.js
// ─────────────────────────────────────────────────────────────────────────────
// /setprompt file:<attachment> — Admin uploads a .txt file containing the
// system prompt Claude will use for /ask queries. Saved per-guild in Supabase.
// No character limit — Discord modals cap at 4000 chars, file upload does not.
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { upsertGuildSettings } from '../../services/supabase.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('setprompt')
  .setDescription('Upload a .txt file to set the AI system prompt Claude uses for /ask')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addAttachmentOption((opt) =>
    opt
      .setName('file')
      .setDescription('A plain-text (.txt) file containing the system prompt')
      .setRequired(true),
  );

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const attachment = interaction.options.getAttachment('file');

  if (!attachment) {
    return interaction.editReply({
      embeds: [errorEmbed('No File Attached', 'Please attach a `.txt` file when running this command.\n\nIf the file option is not showing, run `/sync` first to update the command.')],
    });
  }

  if (!attachment.contentType?.startsWith('text/') && !attachment.name.endsWith('.txt')) {
    return interaction.editReply({
      embeds: [errorEmbed('Invalid File Type', 'Please upload a plain-text **`.txt`** file.')],
    });
  }

  let prompt;
  try {
    const res = await fetch(attachment.url);
    prompt = await res.text();
  } catch (err) {
    logger.error('setprompt: failed to fetch attachment', { guildId: interaction.guildId, error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('Download Failed', 'Could not read the uploaded file. Please try again.')],
    });
  }

  if (!prompt.trim()) {
    return interaction.editReply({
      embeds: [errorEmbed('Empty File', 'The uploaded file is empty.')],
    });
  }

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
          `Prompt saved — **${prompt.length.toLocaleString()}** characters.\nUsers can now use \`/ask\` to chat with Claude.`,
        ),
      ],
    });

  } catch (err) {
    logger.error('setprompt: DB save failed', { guildId: interaction.guildId, error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('Save Failed', 'Could not save the prompt to the database. Please try again.')],
    });
  }
}
