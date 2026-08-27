const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('./db');

const ADMIN_USER_IDS = new Set(
  (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;

// Off by default: treat anyone with the server's own Administrator
// permission as a bot admin too, on top of ADMIN_USER_IDS/ADMIN_ROLE_ID.
// Only turn this on for servers where you trust everyone with that
// permission to hand out and revoke license keys.
const TRUST_SERVER_ADMINS = process.env.TRUST_SERVER_ADMINS === 'true';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function isAdmin(interaction) {
  if (ADMIN_USER_IDS.has(interaction.user.id)) return true;
  if (ADMIN_ROLE_ID && interaction.member?.roles?.cache?.has(ADMIN_ROLE_ID)) return true;
  if (TRUST_SERVER_ADMINS && interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
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
  new SlashCommandBuilder()
    .setName('addhash')
    .setDescription('[admin] Register a known-good jar hash for the build you just shipped')
    .addStringOption((o) => o.setName('sha256').setDescription('SHA-256 of the jar').setRequired(true))
    .addStringOption((o) => o.setName('label').setDescription('e.g. version number')),
  new SlashCommandBuilder()
    .setName('removehash')
    .setDescription('[admin] Remove a known-good jar hash')
    .addStringOption((o) => o.setName('sha256').setDescription('SHA-256 to remove').setRequired(true)),
  new SlashCommandBuilder().setName('hashes').setDescription('[admin] List registered known-good jar hashes'),
  new SlashCommandBuilder()
    .setName('tamperlog')
    .setDescription('[admin] Show recent tampered-jar detections')
    .addIntegerOption((o) => o.setName('limit').setDescription('How many to show (default 10)')),
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

      case 'addhash': {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "You can't use this command.", ephemeral: true });
        }
        const sha256 = interaction.options.getString('sha256', true).trim();
        if (!/^[0-9a-fA-F]{64}$/.test(sha256)) {
          return interaction.reply({ content: 'That doesn\'t look like a SHA-256 hash (64 hex chars).', ephemeral: true });
        }
        const label = interaction.options.getString('label');
        db.addKnownHash(sha256, label);
        return interaction.reply({ content: `Registered \`${sha256}\`${label ? ` (${label})` : ''} as known-good.`, ephemeral: true });
      }

      case 'removehash': {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "You can't use this command.", ephemeral: true });
        }
        const sha256 = interaction.options.getString('sha256', true).trim();
        const ok = db.removeKnownHash(sha256);
        return interaction.reply({ content: ok ? 'Removed.' : 'No such hash.', ephemeral: true });
      }

      case 'hashes': {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "You can't use this command.", ephemeral: true });
        }
        const rows = db.listKnownHashes();
        if (!rows.length) {
          return interaction.reply({
            content: 'No known-good hashes registered yet — every jar hash will be treated as untampered until you add one.',
            ephemeral: true,
          });
        }
        return interaction.reply({
          content: rows.map((r) => `\`${r.sha256}\`${r.label ? ` — ${r.label}` : ''}`).join('\n'),
          ephemeral: true,
        });
      }

      case 'tamperlog': {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: "You can't use this command.", ephemeral: true });
        }
        const limit = interaction.options.getInteger('limit') ?? 10;
        const rows = db.recentTamperLog(limit);
        if (!rows.length) {
          return interaction.reply({ content: 'No tamper detections logged.', ephemeral: true });
        }
        const lines = rows.map(
          (r) =>
            `<t:${Math.floor(r.detected_at)}:R> key \`${r.key || '?'}\` uuid \`${r.minecraft_uuid || '?'}\` hash \`${r.jar_sha256}\``
        );
        return interaction.reply({ content: lines.join('\n'), ephemeral: true });
      }
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      await interaction.reply({ content: 'Something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
});

async function notifyTamper({ key, uuid, username, jarHash }) {
  const message =
    `⚠️ **Tampered jar detected**\n` +
    `Key: \`${key || 'unknown'}\`\n` +
    `Minecraft account: \`${username || uuid}\`\n` +
    `Jar SHA-256: \`${jarHash}\` (not a registered known-good build)`;

  for (const adminId of ADMIN_USER_IDS) {
    try {
      const user = await client.users.fetch(adminId);
      await user.send(message);
    } catch (e) {
      console.error(`Could not DM admin ${adminId} about tamper detection:`, e.message);
    }
  }
}

module.exports = { client, notifyTamper };
