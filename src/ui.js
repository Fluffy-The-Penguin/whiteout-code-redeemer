const { EmbedBuilder } = require('discord.js');

const COLORS = Object.freeze({
  primary: 0x2b6ef3,
  success: 0x2ecc71,
  warning: 0xf1c40f,
  danger: 0xe74c3c,
  neutral: 0x95a5a6,
  purple: 0x9b59b6
});

function trim(value, max = 1024) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function listOrNone(items, max = 12) {
  if (!items || items.length === 0) return 'None';
  const visible = items.slice(0, max);
  const extra = items.length - visible.length;
  return `${visible.join('\n')}${extra > 0 ? `\n...and ${extra} more` : ''}`;
}

function createEmbed({ title, description = '', color = COLORS.primary, fields = [], footer = 'Whiteout Code Redeemer' }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(trim(title, 256))
    .setTimestamp()
    .setFooter({ text: footer });

  if (description) embed.setDescription(trim(description, 4096));

  const safeFields = fields
    .filter((field) => field && field.name && field.value !== undefined)
    .slice(0, 25)
    .map((field) => ({
      name: trim(field.name, 256),
      value: trim(field.value, 1024) || 'None',
      inline: Boolean(field.inline)
    }));

  if (safeFields.length > 0) embed.addFields(safeFields);
  return embed;
}

function successEmbed(title, description = '', fields = []) {
  return createEmbed({ title, description, fields, color: COLORS.success });
}

function infoEmbed(title, description = '', fields = []) {
  return createEmbed({ title, description, fields, color: COLORS.primary });
}

function warningEmbed(title, description = '', fields = []) {
  return createEmbed({ title, description, fields, color: COLORS.warning });
}

function errorEmbed(title, description = '', fields = []) {
  return createEmbed({ title, description, fields, color: COLORS.danger });
}

function channelStatus(channelId) {
  return channelId ? `<#${channelId}>` : 'Not set';
}

function redeemSourceLabel(source) {
  if (source === 'auto') return 'Auto Redeem';
  if (source === 'gift-channel') return 'Gift Channel Redeem';
  if (source === 'manual') return 'Manual Redeem';
  return 'Redeem';
}

function statusCountLines(statusCounts) {
  const entries = Object.entries(statusCounts || {}).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return 'None';
  return entries.map(([status, count]) => `**${status}**: ${count}`).join('\n');
}

function redeemStartEmbed({ source, code, pending, total, skipped }) {
  return createEmbed({
    title: redeemSourceLabel(source),
    description: `Redeeming gift code \`${code}\`.`,
    color: source === 'manual' ? COLORS.purple : COLORS.primary,
    fields: [
      { name: 'Pending', value: String(pending), inline: true },
      { name: 'Saved Players', value: String(total), inline: true },
      { name: 'Already Recorded', value: String(skipped), inline: true }
    ]
  });
}

function redeemProgressEmbed({ code, processed, total, skipped }) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 100;
  return createEmbed({
    title: 'Redeem In Progress',
    description: `Working on \`${code}\`.`,
    color: COLORS.primary,
    fields: [
      { name: 'Progress', value: `${processed}/${total} (${pct}%)`, inline: true },
      { name: 'Skipped Existing', value: String(skipped), inline: true }
    ]
  });
}

function redeemSummaryEmbed({ source, code, total, processed, skipped, successCount, abortedStatus, statusCounts, recentLines }) {
  const color = abortedStatus ? COLORS.warning : COLORS.success;
  return createEmbed({
    title: `${redeemSourceLabel(source)} Complete`,
    description: abortedStatus
      ? `Stopped redeeming \`${code}\` because the API returned **${abortedStatus}**.`
      : `Finished redeeming \`${code}\`.`,
    color,
    fields: [
      { name: 'Accepted/Successful', value: String(successCount), inline: true },
      { name: 'Processed', value: String(processed), inline: true },
      { name: 'Skipped Existing', value: String(skipped), inline: true },
      { name: 'Saved Players', value: String(total), inline: true },
      { name: 'Status Counts', value: statusCountLines(statusCounts), inline: false },
      { name: 'Recent Results', value: listOrNone(recentLines, 12), inline: false }
    ]
  });
}

module.exports = {
  COLORS,
  channelStatus,
  createEmbed,
  errorEmbed,
  infoEmbed,
  listOrNone,
  redeemProgressEmbed,
  redeemStartEmbed,
  redeemSummaryEmbed,
  successEmbed,
  warningEmbed
};
