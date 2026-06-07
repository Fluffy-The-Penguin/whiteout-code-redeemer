const { fetchGiftCodes } = require('./codeFetcher');
const { redeemCode } = require('./redeem');
const {
  addHistory,
  getConfiguredGuilds,
  getNotifyChannel,
  getSeenCodes,
  listPlayers,
  markCodesSeen
} = require('./storage');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIntervalMs() {
  const min = Number(process.env.CHECK_INTERVAL_MIN_MS || 300000);
  const max = Number(process.env.CHECK_INTERVAL_MAX_MS || 600000);
  return Math.floor(Math.random() * (Math.max(min, max) - Math.min(min, max) + 1)) + Math.min(min, max);
}

function summarizeResult(result) {
  const player = result.player?.nickname ? `${result.player.nickname} (${result.player.fid})` : result.player?.fid || 'unknown';
  return `${player}: ${result.status || 'UNKNOWN'}${result.message ? ` (${result.message})` : ''}`;
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

async function redeemCodeForGuild(client, guildId, codeInfo, source = 'auto') {
  const players = listPlayers(guildId);
  const channel = await getNotificationChannel(client, guildId);

  if (players.length === 0) {
    return { code: codeInfo.code, total: 0, results: [] };
  }

  if (channel) {
    const prefix = source === 'auto' ? 'New gift code found' : 'Manual redeem started';
    await channel.send(`${prefix}: \`${codeInfo.code}\`. Redeeming for ${players.length} player(s)...`);
  }

  const results = [];
  for (const player of players) {
    try {
      const result = await redeemCode(player.fid, codeInfo.code);
      results.push({ fid: player.fid, label: player.label, result });

      if (result.rateLimited && result.retryDelay) {
        await wait(result.retryDelay);
      }
    } catch (error) {
      results.push({
        fid: player.fid,
        label: player.label,
        result: { success: false, status: 'ERROR', message: error.message }
      });
    }
  }

  const successCount = results.filter((entry) => entry.result.success).length;
  const lines = results.map((entry) => summarizeResult(entry.result));
  const summary = `Finished ${source} redeem for \`${codeInfo.code}\`: ${successCount}/${results.length} successful/accepted.\n${lines.join('\n')}`;

  addHistory(guildId, {
    code: codeInfo.code,
    date: codeInfo.date,
    source,
    total: results.length,
    successCount,
    results: results.map((entry) => ({
      fid: entry.fid,
      label: entry.label,
      status: entry.result.status,
      success: entry.result.success,
      message: entry.result.message
    }))
  });

  if (channel) {
    await sendLong(channel, summary);
  }

  return { code: codeInfo.code, total: results.length, successCount, results };
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
