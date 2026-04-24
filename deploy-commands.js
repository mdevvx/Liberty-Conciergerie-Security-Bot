// deploy-commands.js
// Run once to register all slash commands with Discord:
//   node deploy-commands.js          ← registers to THIS guild instantly
//   node deploy-commands.js --global ← registers globally (up to 1 hour delay)

import 'dotenv/config';
import { REST, Routes, Collection } from 'discord.js';
import { loadCommands } from './src/handlers/commandHandler.js';
import { config } from './src/config/config.js';
import { readdirSync } from 'fs';

const client = { commands: new Collection() };
await loadCommands(client);

const payload = client.commands.map((cmd) => cmd.data.toJSON());
const rest = new REST().setToken(config.discord.token);

const isGlobal = process.argv.includes('--global');

if (isGlobal) {
  await rest.put(Routes.applicationCommands(config.discord.clientId), { body: payload });
  console.log(`✅ Registered ${payload.length} commands globally (up to 1 hour to propagate).`);
} else {
  // Guild-scoped = instant. Grab the first guild the bot is in.
  const tempClient = { guilds: { cache: new Map() } };
  const guildId = process.env.DEV_GUILD_ID;

  if (!guildId) {
    console.error('❌ Set DEV_GUILD_ID in your .env to use guild (instant) registration.');
    console.error('   Or run with --global for global registration.');
    process.exit(1);
  }

  await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, guildId),
    { body: payload }
  );
  console.log(`✅ Registered ${payload.length} commands to guild ${guildId} (instant).`);
}

payload.forEach((c) => console.log(`   /${c.name}`));
