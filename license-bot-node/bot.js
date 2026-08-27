const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
} = require('discord.js');
const db = require('./db');

const ADMIN_USER_IDS = new Set(
  (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function isAdmin(interaction) {
  if (ADMIN_USER_IDS.has(interaction.user.id)) return true;
  if (ADMIN_ROLE_ID && interaction.member?.roles?.cache?.has(ADMIN_ROLE_ID)) return true;
  return false;
}

function statusLine(lic) {
  let status;
  if (lic.revoked) status = 'REVOKED';
  else if (lic.bound_uuid) status = `bound to \`${lic.bound_username || lic.bound_uuid}\``;
  else status = 'unbound (not yet activated)';
  return `\`${lic.key}\` — ${status}`;
}

const commands = [
  new SlashCommandBuilder()
    .setName('genkey')
    .setDescription('[admin] Generate a new license key for a member')
    .addUserOption((o) => o.setName('member').setDescription('Who this key is for').setRequired(true))
    .addStringOption((o) => o.setName('note').setDescription('Optional note (e.g. order id)')),
  new SlashCommandBuilder().setName('mykeys').setDescription('See your own license keys and their status'),
  new SlashCommandBuilder()
    .setName('lookup')
    .setDescription('[admin] Look up a license key')
    .addStringOption((o) => o.setName('key').setDescription('The license key').setRequired(true)),
  new SlashCommandBuilder()
    .setName('revoke')
    .setDescription('[admin] Revoke a license key')
    .addStringOption((o) => o.setName('key').setDescription('The license key to revoke').setRequired(true)),
  new SlashCommandBuilder()
    .setName('unbind')
    .setDescription("[admin] Unbind a key so it can activate on a new Minecraft account")
    .addStringOption((o) => o.setName('key').setDescription('The license key to unbind').setRequired(true)),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  const appId = client.application.id;
  if (process.env.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(appId, process.env.DISCORD_GUILD_ID), {
      body: commands,
    });
  } else {
    await rest.put(Routes.applicationCommands(appId), { body: commands });
  }
}

client.once('ready', async () => {
  await registerCommands();
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'genkey': {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "You can't use this command.", ephemeral: true });
        }
        const member = interaction.options.getUser('member', true);
        const note = interaction.options.getString('note');
        const key = db.createLicense(member.id, note);

        let dmSent = true;
        try {
          await member.send(
            `You've been issued a TPA Tools license key:\n\`${key}\`\n\n` +
              "Put this in your mod config. It activates on the first Minecraft " +
              "account that uses it and won't work on any other account after that, " +
              "so don't share it."
          );
        } catch {
          dmSent = false;
        }

        let msg = `Created key \`${key}\` for <@${member.id}>.`;
        if (!dmSent) msg += "\n⚠️ Couldn't DM them (DMs closed) — you'll need to send it manually.";
        return interaction.reply({ content: msg, ephemeral: true });
      }

      case 'mykeys': {
        const licenses = db.licensesForUser(interaction.user.id);
        if (!licenses.length) {
          return interaction.reply({ content: 'You have no license keys.', ephemeral: true });
        }
        return interaction.reply({ content: licenses.map(statusLine).join('\n'), ephemeral: true });
      }

      case 'lookup': {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "You can't use this command.", ephemeral: true });
        }
        const key = interaction.options.getString('key', true);
        const lic = db.getLicense(key);
        if (!lic) return interaction.reply({ content: 'No such key.', ephemeral: true });
        return interaction.reply({
          content:
            `Key: \`${lic.key}\`\n` +
            `Owner: <@${lic.discord_user_id}>\n` +
            `Status: ${statusLine(lic)}\n` +
            `Mismatch attempts: ${lic.mismatch_attempts}\n` +
            `Note: ${lic.note || '-'}`,
          ephemeral: true,
        });
      }

      case 'revoke': {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "You can't use this command.", ephemeral: true });
        }
        const key = interaction.options.getString('key', true);
        const ok = db.revokeLicense(key);
        return interaction.reply({ content: ok ? 'Revoked.' : 'No such key.', ephemeral: true });
      }

      case 'unbind': {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "You can't use this command.", ephemeral: true });
        }
        const key = interaction.options.getString('key', true);
        const ok = db.unbindLicense(key);
        return interaction.reply({
          content: ok ? "Unbound — it'll activate on whichever account uses it next." : 'No such key.',
          ephemeral: true,
        });
      }
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      await interaction.reply({ content: 'Something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
});

module.exports = client;
