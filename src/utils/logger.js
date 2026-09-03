// src/utils/logger.js
// ─────────────────────────────────────────────────────────────────────────────
// Winston logger with:
//  - Console output (coloured, human-readable)
//  - Daily rotating log files (logs/combined-YYYY-MM-DD.log)
//  - Separate error log file (logs/error-YYYY-MM-DD.log)
// ─────────────────────────────────────────────────────────────────────────────

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config/config.js';
import { DiscordChannelTransport } from './discordChannelTransport.js';

const { combine, timestamp, colorize, printf, errors } = winston.format;

// ── Custom log format ─────────────────────────────────────────────────────────
const logFormat = printf(({ level, message, timestamp, stack, guildId, ...meta }) => {
  // Optionally tag logs with a guild ID for easier debugging in multi-server use
  const guildTag = guildId ? ` [Guild: ${guildId}]` : '';
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${level}]${guildTag}: ${stack || message}${metaStr}`;
});

// ── Transports ────────────────────────────────────────────────────────────────

// Console — pretty and coloured for dev
const consoleTransport = new winston.transports.Console({
  format: combine(
    colorize({ all: true }),
    timestamp({ format: 'HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
});

// Combined log file — all levels
const combinedFileTransport = new DailyRotateFile({
  filename: 'logs/combined-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',   // Keep 2 weeks of logs
  format: combine(
    timestamp(),
    errors({ stack: true }),
    logFormat
  ),
});

// Error-only log file
const errorFileTransport = new DailyRotateFile({
  filename: 'logs/error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxFiles: '30d',
  format: combine(
    timestamp(),
    errors({ stack: true }),
    logFormat
  ),
});

// Discord channel mirror — posts every guild-tagged log line into that guild's
// configured log channel (/log_channel). Inert until setLogSink() runs on ready.
const discordChannelTransport = new DiscordChannelTransport({
  level: config.app.logLevel,
  format: combine(timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), logFormat),
});

/**
 * Connect the log-channel transport to the logged-in client.
 * @param {import('discord.js').Client} client
 * @param {(guildId: string) => Promise<string|null>} resolveChannelId
 */
export function setLogSink(client, resolveChannelId) {
  discordChannelTransport.setSink(client, resolveChannelId);
}

// ── Create logger instance ────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: config.app.logLevel,
  transports: [consoleTransport, combinedFileTransport, errorFileTransport, discordChannelTransport],
});

export default logger;
