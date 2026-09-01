// deploy-commands.js
// ─────────────────────────────────────────────────────────────────────────────
// Standalone command registration (without booting the bot).
//
//   node deploy-commands.js            ← registers to DEV_GUILD_ID (instant) and
//                                        clears the global command set
//   node deploy-commands.js --clear    ← removes commands from DEV_GUILD_ID
//
// The running bot also re-registers commands to every guild it's in on startup
// (see src/events/ready.js), so this script is only needed for local testing.
// Global registration is intentionally not supported: global commands show up
// in every server that authorised the app, not just the ones the bot joined.
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { REST, Routes, Collection } from 'discord.js';
import { loadCommands } from './src/handlers/commandHandler.js';
import { config } from './src/config/config.js';

const client = { commands: new Collection() };
await loadCommands(client);

const rest = new REST().setToken(config.discord.token);
const guildId = process.env.DEV_GUILD_ID;

if (!guildId) {
  console.error('❌ Set DEV_GUILD_ID in your .env (right-click your server → Copy Server ID).');
  process.exit(1);
}

const clear = process.argv.includes('--clear');
const payload = clear ? [] : client.commands.map((cmd) => cmd.data.toJSON());

// Always wipe global commands — stale global copies (e.g. ones registered
// before permission gating was added) otherwise keep showing to everyone.
await rest.put(Routes.applicationCommands(config.discord.clientId), { body: [] });
console.log('🧹 Cleared global commands.');

await rest.put(
  Routes.applicationGuildCommands(config.discord.clientId, guildId),
  { body: payload }
);

if (clear) {
  console.log(`✅ Cleared commands from guild ${guildId}.`);
} else {
  console.log(`✅ Registered ${payload.length} commands to guild ${guildId} (instant).`);
  payload.forEach((c) => console.log(`   /${c.name}`));
}
