require('dotenv').config();

const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const { fetchGiftCodes } = require('./codeFetcher');
const { redeemCodeForGuild, startWatcher } = require('./autoRedeemer');
const { fetchPlayerInfo } = require('./redeem');
const {
  addPlayer,
  getConfiguredGuilds,
  getSeenCodes,
  listPlayers,
  removePlayer,
  setNotifyChannel
} = require('./storage');

function requireManageGuild(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'You need Manage Server permission to use this bot.', ephemeral: true });
  }
  return null;
}

function formatPlayers(players) {
  if (players.length === 0) return 'No players saved yet.';
  return players
    .map((player, index) => {
      const name = player.nickname || player.label || '';
      const stove = player.stoveLv ? `, Furnace ${player.stoveLv}` : '';
      return `${index + 1}. \`${player.fid}\`${name ? ` - ${name}` : ''}${stove}`;
    })
    .join('\n');
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Use this bot inside a server.', ephemeral: true });
    return;
  }

  const permissionReply = requireManageGuild(interaction);
  if (permissionReply) return;

  if (interaction.commandName === 'player-add') {
    const fid = interaction.options.getString('fid', true).trim();
    const label = interaction.options.getString('label') || '';

    if (!/^\d+$/.test(fid)) {
      await interaction.reply({ content: 'FID must contain numbers only.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const info = await fetchPlayerInfo(fid);

    if (!info.success) {
      await interaction.editReply(`Could not add \`${fid}\`: ${info.status} - ${info.message}`);
      return;
    }

    const { created } = addPlayer(interaction.guildId, fid, label || info.nickname, info);
    await interaction.editReply(
      `${created ? 'Added' : 'Updated'} player \`${fid}\`: ${info.nickname}, Furnace ${info.stoveLv}.`
    );
    return;
  }

  if (interaction.commandName === 'player-remove') {
    const fid = interaction.options.getString('fid', true).trim();
    const removed = removePlayer(interaction.guildId, fid);
    await interaction.reply({ content: removed ? `Removed player \`${fid}\`.` : `Player \`${fid}\` was not saved.`, ephemeral: true });
    return;
  }

  if (interaction.commandName === 'players') {
    await interaction.reply({ content: formatPlayers(listPlayers(interaction.guildId)), ephemeral: true });
    return;
  }

  if (interaction.commandName === 'channel-set') {
    setNotifyChannel(interaction.guildId, interaction.channelId);
    await interaction.reply({ content: `Auto-redeem notifications will be posted in ${interaction.channel}.`, ephemeral: true });
    return;
  }

  if (interaction.commandName === 'codes') {
    await interaction.deferReply({ ephemeral: true });
    const { codes, invalid, fetchedAt } = await fetchGiftCodes();
    const text = codes.length === 0
      ? 'No codes found.'
      : codes.map((code) => `\`${code.code}\` - ${code.date}`).join('\n');
    await interaction.editReply(`Fetched at ${fetchedAt}. ${codes.length} code(s), ${invalid.length} invalid line(s).\n${text}`);
    return;
  }

  if (interaction.commandName === 'redeem-code') {
    const code = interaction.options.getString('code', true).trim();
    const players = listPlayers(interaction.guildId);
    if (players.length === 0) {
      await interaction.reply({ content: 'No players saved. Add players with `/player-add` first.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const summary = await redeemCodeForGuild(interaction.client, interaction.guildId, { code, date: new Date().toISOString().slice(0, 10) }, 'manual');
    await interaction.editReply(`Finished manual redeem for \`${code}\`: ${summary.successCount}/${summary.total} successful/accepted. Full results are posted in the configured notification channel if set.`);
    return;
  }

  if (interaction.commandName === 'watch-status') {
    const guilds = getConfiguredGuilds();
    const seenCount = Object.keys(getSeenCodes()).length;
    const players = listPlayers(interaction.guildId);
    await interaction.reply({
      content: `Watcher is running. This server has ${players.length} player(s). Stored seen codes: ${seenCount}. Configured guilds: ${guilds.length}.`,
      ephemeral: true
    });
  }
}

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN is required. Create .env from .env.example.');

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}. Starting automatic code watcher.`);
    startWatcher(client);
  });

  client.on('interactionCreate', (interaction) => {
    handleInteraction(interaction).catch(async (error) => {
      console.error(error);
      const message = `Error: ${error.message}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => null);
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => null);
      }
    });
  });

  await client.login(token);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
