// src/commands/admin/settings_timezone.js
// ─────────────────────────────────────────────────────────────────────────────
// /settings_timezone — Configure the quiet-hours window.
//
// Step 1 (execute):            Show a timezone dropdown.
// Step 2 (handleTimezoneSelect): Respond with a modal to collect start/end times.
// Step 3 (handleTimezoneModal):  Validate inputs and save to guild settings.
//
// During the quiet window, SUSPECT messages are silently deleted (no mod queue,
// no shadow repost, no role changes). TOXIC messages are unaffected.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { getGuildSettings, upsertGuildSettings } from '../../services/supabase.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embed.js';
import { TIMEZONES, parseHHMM } from '../../utils/timezone.js';
import logger from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('settings_timezone')
  .setDescription('Configure the quiet-hours window — SUSPECT messages are silently deleted during this time')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Show timezone dropdown
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const settings = await getGuildSettings(interaction.guildId);

  const currentLine = settings?.quiet_timezone
    ? `**Current window:** \`${settings.quiet_timezone}\` · ${settings.quiet_start} – ${settings.quiet_end}`
    : '**Not configured** — all SUSPECT messages follow the normal mod-queue flow.';

  const tzRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('tz_timezone_select')
      .setPlaceholder('Pick a timezone…')
      .addOptions(TIMEZONES),
  );

  return interaction.editReply({
    embeds: [infoEmbed(
      'Quiet Hours — Step 1 of 2: Timezone',
      `${currentLine}\n\nDuring the quiet window, **SUSPECT** messages are silently deleted — no mod-queue alert, no shadow repost, no role changes.\n\nSelect the timezone for your quiet window below:`,
    )],
    components: [tzRow],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Timezone chosen → show modal for start/end times
// ─────────────────────────────────────────────────────────────────────────────

export async function handleTimezoneSelect(interaction) {
  const timezone = interaction.values[0];

  const modal = new ModalBuilder()
    .setCustomId(`tz_time_modal:${timezone}`)
    .setTitle('Quiet Hours — Step 2: Set Times');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tz_start')
        .setLabel('Start time (24h format, e.g. 19:00)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('19:00')
        .setRequired(true)
        .setMinLength(4)
        .setMaxLength(5),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tz_end')
        .setLabel('End time (24h format, e.g. 09:00)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('09:00')
        .setRequired(true)
        .setMinLength(4)
        .setMaxLength(5),
    ),
  );

  await interaction.showModal(modal);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Modal submitted → validate and save
// ─────────────────────────────────────────────────────────────────────────────

export async function handleTimezoneModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Timezone is encoded in the customId after the first colon
  const timezone = interaction.customId.slice('tz_time_modal:'.length);
  const rawStart = interaction.fields.getTextInputValue('tz_start');
  const rawEnd   = interaction.fields.getTextInputValue('tz_end');

  const quietStart = parseHHMM(rawStart);
  const quietEnd   = parseHHMM(rawEnd);

  if (!quietStart || !quietEnd) {
    return interaction.editReply({
      embeds: [errorEmbed(
        'Invalid Time Format',
        'Times must be in **HH:MM** 24-hour format, e.g. `19:00` or `09:00`.',
      )],
    });
  }

  try {
    await upsertGuildSettings(interaction.guildId, {
      quiet_timezone: timezone,
      quiet_start:    quietStart,
      quiet_end:      quietEnd,
    });

    const tzLabel = TIMEZONES.find((t) => t.value === timezone)?.label ?? timezone;

    logger.info('Quiet hours configured', {
      guildId:    interaction.guildId,
      admin:      interaction.user.tag,
      timezone,
      quietStart,
      quietEnd,
    });

    return interaction.editReply({
      embeds: [successEmbed(
        'Quiet Hours Configured',
        `**Timezone:** ${tzLabel} (\`${timezone}\`)\n**Window:** ${quietStart} – ${quietEnd}\n\nDuring this window, **SUSPECT** messages will be silently deleted. TOXIC messages and the normal approval flow are unaffected outside this window.`,
      )],
    });
  } catch (err) {
    logger.error('Failed to save quiet hours', {
      guildId: interaction.guildId,
      error:   err.message,
    });
    return interaction.editReply({
      embeds: [errorEmbed('Save Failed', `Could not save settings: ${err.message}`)],
    });
  }
}
