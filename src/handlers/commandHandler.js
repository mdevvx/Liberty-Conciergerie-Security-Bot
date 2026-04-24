// src/handlers/commandHandler.js
// ─────────────────────────────────────────────────────────────────────────────
// Auto-loads every command file from src/commands/**/*.js and registers them
// on the Discord client's commands Collection.
// Commands are organised in sub-folders (admin / mod / utility) — this handler
// walks all of them so adding a new command only requires creating the file.
// ─────────────────────────────────────────────────────────────────────────────

import { Collection } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMANDS_PATH = join(__dirname, '..', 'commands');

/**
 * Load all command files into client.commands.
 * @param {import('discord.js').Client} client
 */
export async function loadCommands(client) {
  client.commands = new Collection();

  // Walk each category sub-folder
  const categories = readdirSync(COMMANDS_PATH);

  for (const category of categories) {
    const categoryPath = join(COMMANDS_PATH, category);
    const files = readdirSync(categoryPath).filter((f) => f.endsWith('.js'));

    for (const file of files) {
      const filePath = join(categoryPath, file);
      const command = await import(`file://${filePath}`);

      // Each command file must export `data` (SlashCommandBuilder) and `execute`
      if (!command.data || !command.execute) {
        logger.warn(`⚠️  Command file missing data/execute: ${file}`);
        continue;
      }

      client.commands.set(command.data.name, command);
      logger.info(`📦 Loaded command: /${command.data.name} [${category}]`);
    }
  }

  logger.info(`✅ Total commands loaded: ${client.commands.size}`);
}
