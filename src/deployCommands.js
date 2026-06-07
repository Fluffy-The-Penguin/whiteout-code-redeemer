require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { commands } = require('./discordCommands');

async function main() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !clientId) {
    throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required');
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  await rest.put(route, { body: commands });
  console.log(`Registered ${commands.length} slash command(s) ${guildId ? `for guild ${guildId}` : 'globally'}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
