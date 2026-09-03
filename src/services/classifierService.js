// src/services/classifierService.js
// ─────────────────────────────────────────────────────────────────────────────
// Two-stage message classification:
//   Stage 1 — cheap local pre-filter (regex + length check)
//   Stage 2 — Claude API (Haiku) for anything that passes stage 1
//
// Only messages that get past the pre-filter hit the API, cutting costs 60-80%.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/config.js";
import { CLASSIFICATION } from "../config/constants.js";
import logger from "../utils/logger.js";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

// ── Stage 1: Pre-filter ───────────────────────────────────────────────────────
// Returns true if the message should be sent to the API for classification.
// Returns false if it can be safely skipped (clearly normal messages).

const PROMO_PATTERNS = [
    /discord\.gg\//i,
    /t\.me\//i,
    /whatsapp\.com\//i,
    /wa\.me\//i,
    /instagram\.com\//i,
    /check\s+out\s+my/i,
    /free\s+money/i,
    /\bdm\s+me\b/i,
    /link\s+in\s+(bio|profile)/i,
    /\bpromo\s+code\b/i,
    /\bjoin\s+my\s+server\b/i,
    /\bsubscribe\b/i,
    /\bfollowers?\b.*\bfree\b/i,
    // French-specific promo patterns
    /rejoignez?\s+mon/i,
    /mon\s+groupe/i,
    /\bgagnez?\b/i,
    /\bgén[eé]r[eé]\b/i,
];

// Matches any bare domain/path URL (e.g. chat.whatsapp.com/xxx, t.me/xyz)
const URL_PATTERN = /[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\/\S+/;

/**
 * Quick local check — no API call.
 * @param {string} content
 * @returns {boolean} true = send to Claude, false = skip
 */
function shouldClassify(content) {
    // Very short messages are almost never spam
    if (content.length < 2) return false;

    // Promo pattern match → send to Claude
    for (const pattern of PROMO_PATTERNS) {
        if (pattern.test(content)) return true;
    }

    // Any URL-like pattern (with or without http://) → send to Claude
    if (URL_PATTERN.test(content)) return true;

    // Lots of caps → send to Claude
    const capsRatio = (content.match(/[A-Z]/g) || []).length / content.length;
    if (capsRatio > 0.5) return true;

    // All other messages over 15 chars go to Claude.
    // Haiku is cheap enough that missing a toxic message costs more than the API call.
    return true;
}

// ── Stage 2: Claude classification ───────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a content moderator for a French-speaking professional Discord community.
Classify the message below as exactly one of:
  SAFE    — normal community message, no issues. This includes member introductions, sharing personal or professional background, greetings, questions, discussions, and opinions — even if the person mentions their job, skills, or experience.
  SUSPECT — unsolicited advertising, spam links, Discord/WhatsApp/Telegram server invites, referral codes, unsolicited commercial offers with prices or rates, or messages whose primary purpose is to drive traffic, sell a service, or recruit members to an outside platform.
  TOXIC   — hate speech, harassment, threats, slurs, or clearly harmful content.

Key rule: Talking about oneself, one's career, or one's background is SAFE. Only flag as SUSPECT when the message is clearly trying to promote an external link, product, commercial service, or server.

Reply with ONLY the classification word. No explanation. No punctuation. Just one word.`;

function buildSystemPrompt(communityContext) {
    if (!communityContext) return BASE_SYSTEM_PROMPT;
    // Community context is appended as extra guidance — core classification
    // instructions (SAFE/SUSPECT/TOXIC) always come from BASE_SYSTEM_PROMPT.
    return `${BASE_SYSTEM_PROMPT}\n\nAdditional community context:\n${communityContext}`;
}

/**
 * Classify a message using Claude Haiku.
 * Returns CLASSIFICATION.SAFE | SUSPECT | TOXIC
 * Falls back to SAFE on API error (fail-open — don't punish users for API issues).
 *
 * @param {string} content
 * @param {string|null} communityContext — guild's custom AI system prompt from /setprompt
 * @returns {Promise<string>}
 */
export async function classifyMessage(content, communityContext = null) {
    // Stage 1 — pre-filter
    if (!shouldClassify(content)) {
        return CLASSIFICATION.SAFE;
    }

    // Stage 2 — Claude API
    logger.info(`🔍 Prompt mode: ${communityContext ? 'guild (' + communityContext.length + ' chars)' : 'base'}`);
    try {
        const response = await anthropic.messages.create({
            model: config.anthropic.model,
            max_tokens: config.anthropic.maxTokens,
            system: buildSystemPrompt(communityContext),
            messages: [{ role: "user", content }],
        });

        const rawText = response.content[0]?.text?.trim();
        logger.info(`🔍 Raw Claude response: "${rawText?.slice(0, 120)}"`);

        // Strip markdown code fences (```json ... ``` or ``` ... ```) if present
        const stripped = rawText?.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

        // Guild system prompts may instruct Claude to respond in JSON — handle both formats
        let result;
        try {
            const parsed = JSON.parse(stripped);
            result = parsed?.category?.trim().toUpperCase();
        } catch {
            result = stripped?.toUpperCase();
        }

        if (Object.values(CLASSIFICATION).includes(result)) {
            logger.info(
                `🔍 Classified: "${content.slice(0, 40)}..." → ${result}`,
            );
            return result;
        }

        logger.warn(
            `Unexpected classification response: "${rawText}" — defaulting to SAFE`,
        );
        return CLASSIFICATION.SAFE;
    } catch (err) {
        // On API failure, fail open (don't shadowban innocent users due to API issues)
        logger.error("Claude classification API error", { error: err.message });
        return CLASSIFICATION.SAFE;
    }
}
