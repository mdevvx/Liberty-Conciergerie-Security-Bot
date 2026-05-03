# 👁️ Shadowban Bot

A Discord bot that silently intercepts suspicious messages, routes them to a private mod queue, and lets moderators Approve / Reject / Release with one click. Built with discord.js v14, Claude AI (Haiku), and Supabase.

---

## Stack

- **discord.js v14** — bot framework
- **Anthropic Claude Haiku** — message classification
- **Supabase (PostgreSQL)** — guild settings + message tracking
- **Winston** — structured logging with daily rotating files
- **Railway / Render** — hosting

---

## Quick Start

### 1. Clone & install

```bash
git clone <your-repo>
cd shadowban-bot
npm install
```

### 2. Environment variables

```bash
cp .env.example .env
# Fill in all values in .env
```

### 3. Supabase schema

- Open your Supabase project → **SQL Editor** → **New Query**
- Paste and run the contents of `data/schema.sql`

### 4. Discord bot setup

- Go to [Discord Developer Portal](https://discord.com/developers/applications)
- Create a new application → Bot
- Enable these **Privileged Gateway Intents**:
    - ✅ Server Members Intent
    - ✅ Message Content Intent
- Copy the bot token → paste into `.env`
- Invite the bot with these permissions:
    - Manage Messages, Manage Roles, Manage Webhooks, Read Message History, Send Messages, View Channels

### 5. Run

```bash
npm start
# or for development with auto-restart:
npm run dev
```

### 6. First-time server setup

Once the bot is in your server:

```
/sync          → register all slash commands globally (wait up to 1hr)
/setup         → set your shadow channel + mod queue channel
```

---

## Commands

| Command        | Permission      | Description                              |
| -------------- | --------------- | ---------------------------------------- |
| `/setup`       | Administrator   | Set shadow channel + mod queue channel   |
| `/toggle`      | Administrator   | Enable or disable the bot in this server |
| `/sync`        | Administrator   | Register all slash commands globally     |
| `/shadowban`   | Manage Messages | Manually shadowban a user                |
| `/unshadowban` | Manage Messages | Remove shadowban from a user             |
| `/status`      | Everyone        | Show bot health and server stats         |
| `/help`        | Everyone        | List all commands                        |

---

## How the shadowban flow works

1. A member posts a message.
2. A local regex pre-filter checks it instantly.
   - If it looks clean → message goes through normally.
   - If it looks suspicious → sent to Claude AI (Haiku) for classification.
3. Claude returns one of three results:
   - **Safe** → message goes through normally.
   - **Toxic** → triggers the shadowban flow (see below).
   - **Suspect** → also triggers the shadowban flow.
4. **Shadowban flow** (runs in under 300ms):
   - Original message is deleted.
   - User is assigned the `Shadowed` role.
   - Message is reposted in the shadow channel (visible only to shadowed users + mods).
   - A mod queue card with action buttons is posted in the private mod channel.
5. **Mod clicks a button:**
   - ✅ Approve → message is reposted publicly and Shadow role is removed.
   - 🚫 Reject → message stays in the shadow channel only, permanently.
   - 🔓 Release → Shadow role is removed, message is not reposted.

---

## Server setup (Discord)

You need two dedicated channels:

1. **Shadow channel** — only visible to `Shadowed` role + mods. The bot creates the `Shadowed` role automatically.
2. **Mod queue channel** — private mod-only channel where Approve/Reject/Release buttons appear.

---

## Logs

Logs are written to the `logs/` directory:

- `logs/combined-YYYY-MM-DD.log` — all levels
- `logs/error-YYYY-MM-DD.log` — errors only
- Retained for 14 days (combined) and 30 days (errors)

---

## Hosting on Railway

1. Push to GitHub
2. New project on [Railway](https://railway.app) → Deploy from GitHub
3. Add environment variables in Railway dashboard
4. Deploy — Railway auto-runs `npm start`
