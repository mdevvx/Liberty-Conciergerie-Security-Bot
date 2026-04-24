// src/events/ready.js
// ─────────────────────────────────────────────────────────────────────────────
// Fires once when the bot successfully connects to Discord.
// ─────────────────────────────────────────────────────────────────────────────

import { ActivityType } from "discord.js";
import logger from "../utils/logger.js";

export const name = "clientReady";
export const once = true;

export async function execute(client) {
    // Set a visible status so users know the bot is watching
    // client.user.setPresence({
    //     activities: [{ name: "", type: ActivityType.Watching }],
    //     status: "online",
    // });

    logger.info(`🤖 Bot online: ${client.user.tag}`);
    logger.info(`📡 Connected to ${client.guilds.cache.size} guild(s)`);
}
