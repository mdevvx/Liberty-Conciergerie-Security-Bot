// src/commands/utility/help.js
// ─────────────────────────────────────────────────────────────────────────────
// /help — Show all available commands grouped by category.
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { COLORS, EMOJI } from '../../config/constants.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all available commands and what they do');

export async function execute(interaction, client) {
  // Group commands by their folder category
  // We infer category from the command file path stored at load time if available,
  // otherwise we categorise by name pattern
  const adminCommands = ['toggle', 'sync', 'setup'];
  const modCommands = ['shadowban', 'unshadowban'];
  const utilityCommands = ['status', 'help'];

  const format = (names) =>
    names
      .map((name) => {
        const cmd = client.commands.get(name);
        return cmd ? `\`/${cmd.data.name}\` — ${cmd.data.description}` : null;
      })
      .filter(Boolean)
      .join('\n');

  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(`${EMOJI.BOT} Shadowban Bot — Commands`)
    .setDescription('All commands are slash commands. Use `/` to trigger them.')
    .addFields(
      {
        name: `🔒 Admin`,
        value: format(adminCommands) || 'None loaded',
      },
      {
        name: `${EMOJI.MOD} Moderation`,
        value: format(modCommands) || 'None loaded',
      },
      {
        name: `${EMOJI.INFO} Utility`,
        value: format(utilityCommands) || 'None loaded',
      },
    )
    .setFooter({ text: 'Admin commands require Administrator • Mod commands require Manage Messages' })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], ephemeral: true });
}
