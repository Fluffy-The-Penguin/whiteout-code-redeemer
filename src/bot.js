require('dotenv').config();

const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const { fetchGiftCodes } = require('./codeFetcher');
const { redeemCodeForGuild, startWatcher } = require('./autoRedeemer');
const { deployGlobalCommands } = require('./deployCommands');
const { getFurnaceLabel } = require('./furnaceReadable');
const { fetchPlayerInfo } = require('./redeem');
const { channelStatus, errorEmbed, infoEmbed, listOrNone, successEmbed, warningEmbed } = require('./ui');
const {
  addPlayer,
  getConfiguredGuilds,
  getGiftChannel,
  getGuildByGiftChannel,
  getGuildByIdChannel,
  getIdChannel,
  getStorageStats,
  listPlayers,
  removePlayer,
  setGiftChannel,
  setIdChannel,
  setNotifyChannel
} = require('./storage');

function requireManageGuild(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      embeds: [errorEmbed('Permission Required', 'You need **Manage Server** permission to use this bot.')],
      ephemeral: true
    });
  }
  return null;
}

function formatPlayers(players) {
  if (players.length === 0) return [];
  return players
    .map((player, index) => {
      const name = player.nickname || player.label || '';
      const stove = player.stoveLv ? `, ${getFurnaceLabel(player.stoveLv)}` : '';
      return `${index + 1}. \`${player.fid}\`${name ? ` - ${name}` : ''}${stove}`;
    })
    .join('\n');
}

function extractGiftCode(content) {
  const trimmed = String(content || '').trim();
  const prefixed = trimmed.match(/(?:code|gift\s*code)\s*[:：]\s*([a-zA-Z0-9]+)/i);
  const candidate = prefixed ? prefixed[1] : trimmed;

  if (!/^[a-zA-Z0-9]{3,32}$/.test(candidate)) return null;
  return candidate;
}

function extractPlayerIds(content) {
  const matches = String(content || '').match(/\b\d{5,12}\b/g) || [];
  return [...new Set(matches)].slice(0, 30);
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guildId) {
    await interaction.reply({ embeds: [warningEmbed('Server Only', 'Use this bot inside a Discord server.')], ephemeral: true });
    return;
  }

  const permissionReply = requireManageGuild(interaction);
  if (permissionReply) return;

  if (interaction.commandName === 'player-add') {
    const fid = interaction.options.getString('fid', true).trim();
    const label = interaction.options.getString('label') || '';

    if (!/^\d+$/.test(fid)) {
      await interaction.reply({ embeds: [errorEmbed('Invalid Player ID', 'FID must contain numbers only.')], ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const info = await fetchPlayerInfo(fid);

    if (!info.success) {
      await interaction.editReply({
        embeds: [errorEmbed('Player Not Added', `Could not add \`${fid}\`.`, [
          { name: 'Status', value: info.status || 'Unknown', inline: true },
          { name: 'Message', value: info.message || 'No details', inline: false }
        ])]
      });
      return;
    }

    const { created } = addPlayer(interaction.guildId, fid, label || info.nickname, info);
    await interaction.editReply({
      embeds: [successEmbed(created ? 'Player Added' : 'Player Updated', `Saved \`${fid}\` for automatic gift-code redemption.`, [
        { name: 'Nickname', value: info.nickname || 'Unknown', inline: true },
        { name: 'Level', value: getFurnaceLabel(info.stoveLv), inline: true },
        { name: 'Label', value: label || info.nickname || 'None', inline: true }
      ])]
    });
    return;
  }

  if (interaction.commandName === 'player-remove') {
    const fid = interaction.options.getString('fid', true).trim();
    const removed = removePlayer(interaction.guildId, fid);
    await interaction.reply({
      embeds: [removed
        ? successEmbed('Player Removed', `Removed \`${fid}\` from automatic redemption.`)
        : warningEmbed('Player Not Found', `Player \`${fid}\` was not saved.`)
      ],
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === 'players') {
    const players = formatPlayers(listPlayers(interaction.guildId));
    await interaction.reply({
      embeds: [infoEmbed('Saved Players', players.length === 0 ? 'No players saved yet.' : `These players are used for automatic redemption.`, [
        { name: `Players (${players.length})`, value: listOrNone(players, 20), inline: false }
      ])],
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === 'channel-set') {
    setNotifyChannel(interaction.guildId, interaction.channelId);
    await interaction.reply({
      embeds: [successEmbed('Notification Channel Set', `Auto-redeem results will be posted in ${interaction.channel}.`)],
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === 'gift-channel-set') {
    setGiftChannel(interaction.guildId, interaction.channelId);
    await interaction.reply({
      embeds: [successEmbed('Gift-Code Channel Set', `Gift codes posted in ${interaction.channel} will be detected and redeemed automatically.`, [
        { name: 'Accepted Examples', value: '`gogoWOS`\n`Code: gogoWOS`', inline: false }
      ])],
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === 'id-channel-set') {
    setIdChannel(interaction.guildId, interaction.channelId);
    await interaction.reply({
      embeds: [successEmbed('ID Channel Set', `Player IDs posted in ${interaction.channel} will be validated and saved automatically.`, [
        { name: 'Accepted Examples', value: '`12345678`\n`12345678 87654321`\n`IDs: 12345678, 87654321`', inline: false }
      ])],
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === 'codes') {
    await interaction.deferReply({ ephemeral: true });
    const { codes, invalid, fetchedAt } = await fetchGiftCodes();
    const lines = codes.map((code) => `\`${code.code}\` - ${code.date}`);
    await interaction.editReply({
      embeds: [infoEmbed('Fetched Gift Codes', `Fetched from the shared code API.`, [
        { name: 'Fetched At', value: fetchedAt, inline: false },
        { name: 'Valid Codes', value: String(codes.length), inline: true },
        { name: 'Invalid Lines', value: String(invalid.length), inline: true },
        { name: 'Codes', value: listOrNone(lines, 20), inline: false }
      ])]
    });
    return;
  }

  if (interaction.commandName === 'redeem-code') {
    const code = interaction.options.getString('code', true).trim();
    const players = listPlayers(interaction.guildId);
    if (players.length === 0) {
      await interaction.reply({ embeds: [warningEmbed('No Players Saved', 'Add players with `/player-add` or configure `/id-channel-set` first.')], ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const summary = await redeemCodeForGuild(interaction.client, interaction.guildId, { code, date: new Date().toISOString().slice(0, 10) }, 'manual');
    await interaction.editReply({
      embeds: [successEmbed('Manual Redeem Complete', `Finished redeeming \`${code}\`.`, [
        { name: 'Redeemed', value: String(summary.categoryCounts?.Redeemed || 0), inline: true },
        { name: 'Already Redeemed', value: String(summary.categoryCounts?.['Already Redeemed'] || 0), inline: true },
        { name: 'Unsuccessful', value: String(summary.categoryCounts?.Unsuccessful || 0), inline: true },
        { name: 'Restricted', value: String(summary.categoryCounts?.Restricted || 0), inline: true },
        { name: 'Invalid/Expired', value: String(summary.categoryCounts?.['Invalid/Expired'] || 0), inline: true },
        { name: 'Skipped Existing', value: String(summary.skipped), inline: true },
        { name: 'Saved Players', value: String(summary.total), inline: true },
        { name: 'Results', value: 'Full results are posted in the configured notification channel if set.', inline: false }
      ])]
    });
    return;
  }

  if (interaction.commandName === 'watch-status') {
    const guilds = getConfiguredGuilds();
    const stats = getStorageStats(interaction.guildId);
    const players = listPlayers(interaction.guildId);
    const giftChannel = getGiftChannel(interaction.guildId);
    const idChannel = getIdChannel(interaction.guildId);
    await interaction.reply({
      embeds: [infoEmbed('Watcher Status', 'Automatic code watching is active.', [
        { name: 'Players', value: String(players.length), inline: true },
        { name: 'Seen Codes', value: String(stats.seenCodes), inline: true },
        { name: 'Usage Records', value: String(stats.usage), inline: true },
        { name: 'Configured Servers', value: String(guilds.length), inline: true },
        { name: 'Gift-Code Channel', value: channelStatus(giftChannel), inline: true },
        { name: 'ID Channel', value: channelStatus(idChannel), inline: true }
      ])],
      ephemeral: true
    });
  }
}

async function editIdProgress(progressMessage, processed, total) {
  if (!progressMessage || processed % 5 !== 0) return;
  await progressMessage.edit({
    embeds: [infoEmbed('Checking Player IDs', 'Validating IDs with the Whiteout Survival API.', [
      { name: 'Progress', value: `${processed}/${total}`, inline: true }
    ])]
  }).catch(() => null);
}

async function handleIdChannelMessage(message) {
  if (message.author.bot || !message.guildId) return false;

  const configured = getGuildByIdChannel(message.channelId);
  if (!configured || configured.guild_id !== message.guildId) return false;

  const ids = extractPlayerIds(message.content);
  if (ids.length === 0) return true;

  const progressMessage = await message.reply({
    embeds: [infoEmbed('Checking Player IDs', 'Validating IDs with the Whiteout Survival API.', [
      { name: 'Detected IDs', value: String(ids.length), inline: true },
      { name: 'Limit', value: '30 per message', inline: true }
    ])]
  }).catch(() => null);
  const added = [];
  const updated = [];
  const failed = [];

  for (const fid of ids) {
    try {
      const info = await fetchPlayerInfo(fid);
      if (!info.success) {
        failed.push(`${fid}: ${info.status}`);
      } else {
        const result = addPlayer(message.guildId, fid, info.nickname, info, message.author.id);
        const line = `${fid}: ${info.nickname}, ${getFurnaceLabel(info.stoveLv)}`;
        if (result.created) added.push(line);
        else updated.push(line);
      }
    } catch (error) {
      failed.push(`${fid}: ${error.message}`);
    }

    await editIdProgress(progressMessage, added.length + updated.length + failed.length, ids.length);
  }

  const summaryEmbed = successEmbed('Player Intake Complete', 'Finished checking player IDs from this message.', [
    { name: 'Added', value: String(added.length), inline: true },
    { name: 'Updated', value: String(updated.length), inline: true },
    { name: 'Failed', value: String(failed.length), inline: true },
    { name: 'Added Players', value: listOrNone(added, 10), inline: false },
    { name: 'Updated Players', value: listOrNone(updated, 10), inline: false },
    { name: 'Failed IDs', value: listOrNone(failed, 10), inline: false }
  ]);

  if (progressMessage) {
    await progressMessage.edit({ embeds: [summaryEmbed] }).catch(() => null);
  } else {
    await message.reply({ embeds: [summaryEmbed] }).catch(() => null);
  }

  return true;
}

async function handleGiftCodeMessage(message) {
  if (message.author.bot || !message.guildId) return;

  const configured = getGuildByGiftChannel(message.channelId);
  if (!configured || configured.guild_id !== message.guildId) return;

  const code = extractGiftCode(message.content);
  if (!code) return;

  const players = listPlayers(message.guildId);
  if (players.length === 0) {
    await message.reply({ embeds: [warningEmbed('Gift Code Detected', 'No players are saved yet. Add players with `/player-add` or configure `/id-channel-set` first.')] }).catch(() => null);
    return;
  }

  await redeemCodeForGuild(message.client, message.guildId, { code, date: new Date().toISOString().slice(0, 10) }, 'gift-channel');
}

async function startBot(options = {}) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN is required.');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });
  let watcherStarted = false;

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}.`);

    if (options.deployCommands !== false) {
      await deployGlobalCommands({
        token,
        clientId: process.env.DISCORD_CLIENT_ID || client.application?.id || client.user.id
      });
    }

    if (watcherStarted) return;
    watcherStarted = true;
    console.log('Starting automatic code watcher.');
    startWatcher(client);
  });

  client.on('interactionCreate', (interaction) => {
    handleInteraction(interaction).catch(async (error) => {
      console.error(error);
      const payload = { embeds: [errorEmbed('Unexpected Error', error.message || 'Unknown error')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => null);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => null);
      }
    });
  });

  client.on('messageCreate', (message) => {
    Promise.resolve()
      .then(async () => {
        if (await handleIdChannelMessage(message)) return;
        await handleGiftCodeMessage(message);
      })
      .catch((error) => {
        console.error(`Message handler error: ${error.message}`);
    });
  });

  await client.login(token);
  return client;
}

if (require.main === module) {
  startBot({ deployCommands: true }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  extractGiftCode,
  extractPlayerIds,
  startBot
};
