const { fetchGiftCodes } = require('./codeFetcher');
const { redeemCode } = require('./redeem');
const {
  addHistory,
  getConfiguredGuilds,
  getNotifyChannel,
  getSeenCodes,
  getUsageStats,
  hasGiftCodeUsage,
  listPlayers,
  markCodesSeen,
  recordGiftCodeUsage,
  updateGiftCodeStatus,
  upsertGiftCode
} = require('./storage');

const ABORT_STATUSES = new Set(['USED', 'TIME ERROR', 'CDK NOT FOUND']);
const SUCCESS_OR_ACCEPTED = new Set(['SUCCESS', 'RECEIVED', 'SAME TYPE EXCHANGE']);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIntervalMs() {
  const min = Number(process.env.CHECK_INTERVAL_MIN_MS || 300000);
  const max = Number(process.env.CHECK_INTERVAL_MAX_MS || 600000);
  return Math.floor(Math.random() * (Math.max(min, max) - Math.min(min, max) + 1)) + Math.min(min, max);
}

function resultPlayerLabel(entry) {
  const result = entry.result;
  if (result.player?.nickname) return `${result.player.nickname} (${result.player.fid})`;
  return `${entry.label || 'Player'} (${entry.fid})`;
}

function summarizeResult(entry) {
  const result = entry.result;
  if (entry.skipped) return `${entry.label || 'Player'} (${entry.fid}): SKIPPED (${entry.reason})`;
  return `${resultPlayerLabel(entry)}: ${result.status || 'UNKNOWN'}${result.message ? ` (${result.message})` : ''}`;
}

function countByStatus(results) {
  const counts = {};
  for (const entry of results) {
    const status = entry.skipped ? 'SKIPPED_ALREADY_RECORDED' : entry.result.status || 'UNKNOWN';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function buildSummary(source, code, results, skippedBefore, abortedStatus) {
  const statusCounts = countByStatus(results);
  const successCount = results.filter((entry) => !entry.skipped && SUCCESS_OR_ACCEPTED.has(entry.result.status)).length;
  const processed = results.filter((entry) => !entry.skipped).length;
  const skipped = results.filter((entry) => entry.skipped).length + skippedBefore;

  const statusLines = Object.entries(statusCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}: ${count}`)
    .join('\n');

  const details = results.slice(-30).map(summarizeResult).join('\n');
  const abortLine = abortedStatus ? `\nAborted remaining players because code returned ${abortedStatus}.` : '';

  return {
    successCount,
    processed,
    skipped,
    text:
      `Finished ${source} redeem for \`${code}\`.\n` +
      `Accepted/successful: ${successCount}\n` +
      `Processed: ${processed}\n` +
      `Skipped existing: ${skipped}\n` +
      `${abortLine}\n\n` +
      `Status counts:\n${statusLines || 'None'}\n\n` +
      `Recent results:\n${details || 'None'}`
  };
}

async function sendLong(channel, text) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 1900) {
    chunks.push(remaining.slice(0, 1900));
    remaining = remaining.slice(1900);
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

async function getNotificationChannel(client, guildId) {
  const channelId = getNotifyChannel(guildId);
  if (!channelId) return null;
  return client.channels.fetch(channelId).catch(() => null);
}

async function editProgress(progressMessage, code, processed, total, skipped) {
  if (!progressMessage || processed % 5 !== 0) return;
  await progressMessage.edit(`Redeeming \`${code}\`: ${processed}/${total} processed, ${skipped} skipped existing...`).catch(() => null);
}

async function redeemCodeForGuild(client, guildId, codeInfo, source = 'auto') {
  const players = listPlayers(guildId);
  const channel = await getNotificationChannel(client, guildId);
  const code = String(codeInfo.code || '').trim();

  if (!code) return { code, total: 0, processed: 0, skipped: 0, successCount: 0, results: [] };

  upsertGiftCode(code, codeInfo.date, source === 'auto' ? 'api' : source, 'active');

  if (players.length === 0) {
    return { code, total: 0, processed: 0, skipped: 0, successCount: 0, results: [] };
  }

  const pendingPlayers = [];
  let skippedBefore = 0;
  for (const player of players) {
    if (hasGiftCodeUsage(guildId, player.fid, code)) {
      skippedBefore++;
    } else {
      pendingPlayers.push(player);
    }
  }

  let progressMessage = null;
  if (channel) {
    const prefix = source === 'auto' ? 'New gift code found' : source === 'gift-channel' ? 'Gift code posted' : 'Manual redeem started';
    progressMessage = await channel.send(
      `${prefix}: \`${code}\`. Redeeming for ${pendingPlayers.length}/${players.length} pending player(s). ${skippedBefore} already recorded.`
    );
  }

  const results = [];
  let abortedStatus = null;

  for (const player of pendingPlayers) {
    try {
      const result = await redeemCode(player.fid, code);
      results.push({ fid: player.fid, label: player.label || player.nickname, result });
      recordGiftCodeUsage(guildId, player.fid, code, result);

      if (ABORT_STATUSES.has(result.status)) {
        abortedStatus = result.status;
        updateGiftCodeStatus(code, 'invalid');
        break;
      }

      if (result.rateLimited && result.retryDelay) {
        await wait(result.retryDelay);
      }
    } catch (error) {
      const result = { success: false, status: 'ERROR', message: error.message };
      results.push({ fid: player.fid, label: player.label || player.nickname, result });
      recordGiftCodeUsage(guildId, player.fid, code, result);
    }

    await editProgress(progressMessage, code, results.length, pendingPlayers.length, skippedBefore);
  }

  if (!abortedStatus) {
    updateGiftCodeStatus(code, 'active');
  }

  const summary = buildSummary(source, code, results, skippedBefore, abortedStatus);
  const usageStats = getUsageStats(guildId, code);

  addHistory(guildId, {
    code,
    date: codeInfo.date,
    source,
    total: players.length,
    processed: summary.processed,
    skipped: summary.skipped,
    successCount: summary.successCount,
    usageStats,
    abortedStatus,
    results: results.map((entry) => ({
      fid: entry.fid,
      label: entry.label,
      status: entry.result.status,
      success: entry.result.success,
      message: entry.result.message
    }))
  });

  if (progressMessage) {
    await progressMessage.edit(summary.text.slice(0, 1900)).catch(() => null);
    if (summary.text.length > 1900) {
      await sendLong(channel, summary.text.slice(1900));
    }
  } else if (channel) {
    await sendLong(channel, summary.text);
  }

  return {
    code,
    total: players.length,
    processed: summary.processed,
    skipped: summary.skipped,
    successCount: summary.successCount,
    abortedStatus,
    results
  };
}

async function checkForNewCodes(client, options = {}) {
  const { codes, invalid, fetchedAt } = await fetchGiftCodes();
  const seenCodes = getSeenCodes();
  const newCodes = codes.filter((code) => !seenCodes[code.code]);
  const redeemExistingOnStart = String(process.env.REDEEM_EXISTING_ON_START || 'false').toLowerCase() === 'true';
  const firstRun = Object.keys(seenCodes).length === 0;

  markCodesSeen(codes);

  if (firstRun && !redeemExistingOnStart && !options.forceRedeemExisting) {
    console.log(`Initial code sync complete. Recorded ${codes.length} code(s); waiting for future new codes.`);
    return { fetchedAt, count: codes.length, invalidCount: invalid.length, newCodes: [], initialSync: true };
  }

  if (newCodes.length === 0) {
    console.log(`Code check complete. No new codes. Fetched ${codes.length} code(s).`);
    return { fetchedAt, count: codes.length, invalidCount: invalid.length, newCodes: [] };
  }

  console.log(`Found ${newCodes.length} new code(s): ${newCodes.map((code) => code.code).join(', ')}`);

  const guilds = getConfiguredGuilds();
  for (const codeInfo of newCodes) {
    for (const guild of guilds) {
      await redeemCodeForGuild(client, guild.guildId, codeInfo, 'auto');
    }
  }

  return { fetchedAt, count: codes.length, invalidCount: invalid.length, newCodes };
}

function startWatcher(client) {
  let stopped = false;

  async function loop() {
    while (!stopped) {
      try {
        await checkForNewCodes(client);
      } catch (error) {
        console.error(`Auto watcher error: ${error.message}`);
      }

      const interval = randomIntervalMs();
      console.log(`Next code check in ${Math.round(interval / 1000)}s.`);
      await wait(interval);
    }
  }

  loop();
  return () => {
    stopped = true;
  };
}

module.exports = {
  checkForNewCodes,
  redeemCodeForGuild,
  startWatcher
};
