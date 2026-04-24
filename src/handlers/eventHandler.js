// src/handlers/eventHandler.js
// ─────────────────────────────────────────────────────────────────────────────
// Auto-loads every event file from src/events/*.js and registers them
// on the Discord client using client.on() or client.once().
//
// Each event file must export:
//   name    — the Discord.js event name (e.g. 'messageCreate')
//   once    — boolean, true if the event should fire only once
//   execute — async function that handles the event
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVENTS_PATH = join(__dirname, '..', 'events');

/**
 * Load and register all event listeners.
 * @param {import('discord.js').Client} client
 */
export async function loadEvents(client) {
  const files = readdirSync(EVENTS_PATH).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const filePath = join(EVENTS_PATH, file);
    const event = await import(`file://${filePath}`);

    if (!event.name || !event.execute) {
      logger.warn(`⚠️  Event file missing name/execute: ${file}`);
      continue;
    }

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }

    logger.info(`🎯 Registered event: ${event.name} (once: ${!!event.once})`);
  }
}
