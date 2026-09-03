// src/events/ready.js
// ─────────────────────────────────────────────────────────────────────────────
// Fires once when the bot successfully connects to Discord.
// ─────────────────────────────────────────────────────────────────────────────

import { ActivityType } from "discord.js";
import { deployCommands } from "../utils/deployCommands.js";
import { getLogChannelId } from "../services/supabase.js";
import logger, { setLogSink } from "../utils/logger.js";

export const name = "clientReady";
export const once = true;

export async function execute(client) {
    // Set a visible status so users know the bot is watching
    // client.user.setPresence({
    //     activities: [{ name: "", type: ActivityType.Watching }],
    //     status: "online",
    // });

    // Start mirroring guild-tagged logs into each guild's /log_channel.
    setLogSink(client, getLogChannelId);

    logger.info(`🤖 Bot online: ${client.user.tag}`);
    logger.info(`📡 Connected to ${client.guilds.cache.size} guild(s)`);

    // Re-sync slash commands to every guild the bot is in (and clear the
    // global set). Keeps command visibility + permissions current on each deploy.
    try {
        await deployCommands(client);
    } catch (err) {
        logger.error("Command deployment on startup failed", { error: err.message });
    }
}
