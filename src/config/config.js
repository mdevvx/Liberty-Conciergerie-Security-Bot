// src/config/config.js
// ─────────────────────────────────────────────────────────────────────────────
// Central configuration — all env vars and app settings are read here.
// Import this file anywhere you need config; never read process.env directly.
// ─────────────────────────────────────────────────────────────────────────────

export const config = {
    // Discord
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.DISCORD_CLIENT_ID,
    },

    // Anthropic / Claude API
    anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: "claude-haiku-4-5-20251001", // Classification — short replies
        maxTokens: 100,
        conversationModel: "claude-haiku-4-5-20251001", // /ask conversations
        conversationMaxTokens: 1024,
    },

    // Supabase
    supabase: {
        url: process.env.SUPABASE_URL,
        anonKey: process.env.SUPABASE_SERVICE_KEY,
    },

    // App behaviour
    app: {
        env: process.env.NODE_ENV || "development",
        logLevel: process.env.LOG_LEVEL || "info",
    },
};

// ── Validate required env vars on startup ─────────────────────────────────────
const REQUIRED = [
    "DISCORD_TOKEN",
    "DISCORD_CLIENT_ID",
    "ANTHROPIC_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
];

export function validateConfig() {
    const missing = REQUIRED.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(
            `❌ Missing required environment variables: ${missing.join(", ")}`,
        );
    }
}
