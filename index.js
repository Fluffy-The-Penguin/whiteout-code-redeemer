require('dotenv').config();

const { startBot } = require('./src/bot');

startBot({ deployCommands: true }).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
