// src/index.js
// ─────────────────────────────────────────────────────────────────────────────
// Bot entry point.
//  1. Load env vars
//  2. Validate config
//  3. Create Discord client with required intents
//  4. Load commands and events via handlers
//  5. Login
// ─────────────────────────────────────────────────────────────────────────────

import "dotenv/config";

// Suppress the punycode deprecation warning emitted by discord.js's own deps
const originalEmit = process.emit.bind(process);
process.emit = (event, warning, ...args) => {
    if (
        event === "warning" &&
        warning?.name === "DeprecationWarning" &&
        warning?.message?.includes("punycode")
    )
        return false;
    return originalEmit(event, warning, ...args);
};
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { validateConfig, config } from "./config/config.js";
import { loadCommands } from "./handlers/commandHandler.js";
import { loadEvents } from "./handlers/eventHandler.js";
import logger from "./utils/logger.js";

// ── Validate env vars before doing anything else ──────────────────────────────
try {
    validateConfig();
} catch (err) {
    console.error(err.message);
    process.exit(1);
}

// ── Create client ─────────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent, // Required for reading message content
    ],
    partials: [Partials.Message, Partials.Channel],
});

// ── Load handlers ─────────────────────────────────────────────────────────────
await loadCommands(client);
await loadEvents(client);

// ── Global error safety nets ──────────────────────────────────────────────────
process.on("unhandledRejection", (err) => {
    logger.error("Unhandled promise rejection", {
        error: err.message,
        stack: err.stack,
    });
});

process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", {
        error: err.message,
        stack: err.stack,
    });
    process.exit(1);
});

// ── Login ─────────────────────────────────────────────────────────────────────
await client.login(config.discord.token);
