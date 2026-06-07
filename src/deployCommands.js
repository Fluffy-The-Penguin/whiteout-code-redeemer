require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { commands } = require('./discordCommands');

async function deployGlobalCommands(options = {}) {
  const token = options.token || process.env.DISCORD_TOKEN;
  const clientId = options.clientId || process.env.DISCORD_CLIENT_ID;

  if (!token || !clientId) {
    throw new Error('DISCORD_TOKEN and Discord client ID are required to deploy commands');
  }

  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`Registered ${commands.length} global slash command(s).`);
}

if (require.main === module) {
  deployGlobalCommands().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  deployGlobalCommands
};
