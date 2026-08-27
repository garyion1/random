require('dotenv').config();

const { client, notifyTamper } = require('./bot');
const { app, setTamperNotifier } = require('./api');

setTamperNotifier(notifyTamper);

const port = parseInt(process.env.HTTP_PORT || '8000', 10);
app.listen(port, '0.0.0.0', () => {
  console.log(`License API listening on port ${port}`);
});

client.login(process.env.DISCORD_BOT_TOKEN);
