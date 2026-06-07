const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('player-add')
    .setDescription('Add a Whiteout Survival player FID for auto redeem')
    .addStringOption((option) => option.setName('fid').setDescription('Player FID').setRequired(true))
    .addStringOption((option) => option.setName('label').setDescription('Optional name/label').setRequired(false)),
  new SlashCommandBuilder()
    .setName('player-remove')
    .setDescription('Remove a player FID')
    .addStringOption((option) => option.setName('fid').setDescription('Player FID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('players')
    .setDescription('List saved player FIDs'),
  new SlashCommandBuilder()
    .setName('channel-set')
    .setDescription('Use this channel for auto-redeem notifications'),
  new SlashCommandBuilder()
    .setName('gift-channel-set')
    .setDescription('Use this channel to detect posted gift codes and auto-redeem them'),
  new SlashCommandBuilder()
    .setName('id-channel-set')
    .setDescription('Use this channel to detect posted player IDs and save them'),
  new SlashCommandBuilder()
    .setName('codes')
    .setDescription('Fetch currently known gift codes'),
  new SlashCommandBuilder()
    .setName('redeem-code')
    .setDescription('Manually redeem a code for all saved players')
    .addStringOption((option) => option.setName('code').setDescription('Gift code').setRequired(true)),
  new SlashCommandBuilder()
    .setName('watch-status')
    .setDescription('Show auto watcher status')
].map((command) => command.toJSON());

module.exports = {
  commands
};
