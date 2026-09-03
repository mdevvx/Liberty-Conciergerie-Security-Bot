// src/utils/discordChannelTransport.js
// ─────────────────────────────────────────────────────────────────────────────
// Winston transport that mirrors log lines into a per-guild Discord channel
// using the bot's own account (no webhook).
//
// Every log call that carries a `guildId` in its metadata is buffered per guild
// and flushed on an interval as batched code-block messages (Discord rate-limits
// channel sends, and one request per log line would be far too many).
//
// The transport is inert until setSink(client, resolveChannelId) is called from
// the ready event — before that (and for logs with no guildId) lines are simply
// dropped from this transport. It never throws and never logs through winston.
// ─────────────────────────────────────────────────────────────────────────────

import Transport from 'winston-transport';

const FLUSH_INTERVAL_MS = 2500;
const CONTENT_BUDGET = 1990;          // < 2000, leaves room for the ``` fences
const MAX_LINES_PER_GUILD = 120;      // bound memory / spam if a channel is unreachable

export class DiscordChannelTransport extends Transport {
  constructor(opts = {}) {
    super(opts);
    this.client = null;
    this.resolveChannelId = null;     // async (guildId) => channelId | null
    this.buffers = new Map();         // guildId → string[]
    this.sending = false;

    this.timer = setInterval(() => this._flush(), opts.flushIntervalMs || FLUSH_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
  }

  /** Wire up the logged-in client + the guild→channel lookup. Called once, from ready. */
  setSink(client, resolveChannelId) {
    this.client = client;
    this.resolveChannelId = resolveChannelId;
  }

  log(info, callback) {
    setImmediate(() => this.emit('logged', info));

    const guildId = info.guildId;
    if (guildId) {
      const line = String(info[Symbol.for('message')] ?? `${info.level}: ${info.message}`);
      let buf = this.buffers.get(guildId);
      if (!buf) {
        buf = [];
        this.buffers.set(guildId, buf);
      }
      for (const part of line.split('\n')) {
        buf.push(part.length > CONTENT_BUDGET ? part.slice(0, CONTENT_BUDGET - 1) + '…' : part);
      }
      if (buf.length > MAX_LINES_PER_GUILD) buf.splice(0, buf.length - MAX_LINES_PER_GUILD);
    }

    callback();
  }

  async _flush() {
    if (this.sending || !this.client || !this.resolveChannelId) return;
    this.sending = true;

    try {
      for (const [guildId, buf] of this.buffers) {
        if (buf.length === 0) continue;

        let channelId = null;
        try {
          channelId = await this.resolveChannelId(guildId);
        } catch {
          channelId = null;
        }
        if (!channelId) {
          buf.length = 0; // not configured — discard
          continue;
        }

        const channel =
          this.client.channels.cache.get(channelId) ??
          (await this.client.channels.fetch(channelId).catch(() => null));

        if (!channel || typeof channel.send !== 'function') {
          buf.length = 0;
          continue;
        }

        const lines = buf.splice(0, buf.length);
        let chunk = '';
        for (const l of lines) {
          if (chunk && chunk.length + 1 + l.length > CONTENT_BUDGET) {
            await channel.send('```\n' + chunk + '\n```').catch(() => {});
            chunk = l;
          } else {
            chunk = chunk ? `${chunk}\n${l}` : l;
          }
        }
        if (chunk) await channel.send('```\n' + chunk + '\n```').catch(() => {});
      }
    } catch {
      // never let logging break the bot; never re-log
    } finally {
      this.sending = false;
    }
  }
}
