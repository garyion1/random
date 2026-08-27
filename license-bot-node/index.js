require('dotenv').config();

const client = require('./bot');
const api = require('./api');

const port = parseInt(process.env.HTTP_PORT || '8000', 10);
api.listen(port, '0.0.0.0', () => {
  console.log(`License API listening on port ${port}`);
});

client.login(process.env.DISCORD_BOT_TOKEN);
