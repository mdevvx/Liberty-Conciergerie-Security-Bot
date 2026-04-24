// src/commands/utility/ask.js
// ─────────────────────────────────────────────────────────────────────────────
// /ask <message> — Send a message to Claude. Claude replies using the system
// prompt set by the admin via /setprompt. Each call is independent (no memory
// of previous /ask messages — one-shot per invocation).
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import Anthropic from '@anthropic-ai/sdk';
import { getAiSystemPrompt } from '../../services/supabase.js';
import { warningEmbed, errorEmbed } from '../../utils/embed.js';
import { config } from '../../config/config.js';
import { COLORS, EMOJI } from '../../config/constants.js';
import logger from '../../utils/logger.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask the AI a question using the server\'s configured context')
  .addStringOption((opt) =>
    opt
      .setName('message')
      .setDescription('Your question or message')
      .setRequired(true)
      .setMaxLength(1000)
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const systemPrompt = await getAiSystemPrompt(interaction.guildId);

  if (!systemPrompt) {
    return interaction.editReply({
      embeds: [
        warningEmbed(
          'No System Prompt Set',
          'An admin must run `/setprompt` first to configure the AI before anyone can use `/ask`.'
        ),
      ],
    });
  }

  const userMessage = interaction.options.getString('message');

  try {
    const response = await anthropic.messages.create({
      model: config.anthropic.conversationModel,
      max_tokens: config.anthropic.conversationMaxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const reply = response.content[0]?.text ?? 'No response received.';
    const truncated = reply.length > 4000 ? `${reply.slice(0, 3997)}…` : reply;

    logger.info(`/ask used`, {
      guildId: interaction.guildId,
      user: interaction.user.tag,
      messageLength: userMessage.length,
    });

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.INFO)
          .setTitle(`${EMOJI.BOT} AI Response`)
          .setDescription(truncated)
          .setFooter({ text: `Asked by ${interaction.user.tag}` })
          .setTimestamp(),
      ],
    });
  } catch (err) {
    logger.error('/ask API call failed', { guildId: interaction.guildId, error: err.message });
    return interaction.editReply({
      embeds: [errorEmbed('AI Error', 'Failed to get a response from Claude. Please try again.')],
    });
  }
}
