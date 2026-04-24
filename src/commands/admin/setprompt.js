// src/commands/admin/setprompt.js
// ─────────────────────────────────────────────────────────────────────────────
// /setprompt — Admin sets the system prompt that Claude uses when answering
// /ask queries. Opens a modal so the admin can paste a long prompt (up to
// 4000 characters). The prompt is saved per-guild in Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('setprompt')
  .setDescription('Set the AI system prompt Claude uses when answering /ask questions')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('setprompt_modal')
    .setTitle('Set AI System Prompt');

  const promptInput = new TextInputBuilder()
    .setCustomId('system_prompt')
    .setLabel('System Prompt (up to 4000 characters)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Paste the context or instructions for Claude here…')
    .setRequired(true)
    .setMaxLength(4000);

  modal.addComponents(new ActionRowBuilder().addComponents(promptInput));

  await interaction.showModal(modal);
}
