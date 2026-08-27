import os

import discord
from discord import app_commands

import db

ADMIN_USER_IDS = {
    int(x) for x in os.environ.get("ADMIN_USER_IDS", "").split(",") if x.strip()
}
ADMIN_ROLE_ID = os.environ.get("ADMIN_ROLE_ID")
ADMIN_ROLE_ID = int(ADMIN_ROLE_ID) if ADMIN_ROLE_ID else None

intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)


def is_admin(interaction: discord.Interaction) -> bool:
    if interaction.user.id in ADMIN_USER_IDS:
        return True
    if ADMIN_ROLE_ID and isinstance(interaction.user, discord.Member):
        return any(role.id == ADMIN_ROLE_ID for role in interaction.user.roles)
    return False


def _require_admin(interaction: discord.Interaction) -> bool:
    return is_admin(interaction)


def _status_line(lic) -> str:
    if lic["revoked"]:
        status = "REVOKED"
    elif lic["bound_uuid"]:
        status = f"bound to `{lic['bound_username'] or lic['bound_uuid']}`"
    else:
        status = "unbound (not yet activated)"
    return f"`{lic['key']}` — {status}"


@tree.command(description="[admin] Generate a new license key for a member")
@app_commands.describe(member="Who this key is for", note="Optional note (e.g. order id)")
async def genkey(interaction: discord.Interaction, member: discord.Member, note: str | None = None):
    if not _require_admin(interaction):
        await interaction.response.send_message("You can't use this command.", ephemeral=True)
        return

    key = db.create_license(str(member.id), note)

    dm_sent = True
    try:
        await member.send(
            f"You've been issued a TPA Tools license key:\n`{key}`\n\n"
            "Put this in your mod config. It activates on the first Minecraft "
            "account that uses it and won't work on any other account after that, "
            "so don't share it."
        )
    except discord.Forbidden:
        dm_sent = False

    msg = f"Created key `{key}` for {member.mention}."
    if not dm_sent:
        msg += "\n⚠️ Couldn't DM them (DMs closed) — you'll need to send it manually."
    await interaction.response.send_message(msg, ephemeral=True)


@tree.command(description="See your own license keys and their status")
async def mykeys(interaction: discord.Interaction):
    licenses = db.licenses_for_user(str(interaction.user.id))
    if not licenses:
        await interaction.response.send_message("You have no license keys.", ephemeral=True)
        return
    lines = [_status_line(lic) for lic in licenses]
    await interaction.response.send_message("\n".join(lines), ephemeral=True)


@tree.command(description="[admin] Look up a license key")
@app_commands.describe(key="The license key")
async def lookup(interaction: discord.Interaction, key: str):
    if not _require_admin(interaction):
        await interaction.response.send_message("You can't use this command.", ephemeral=True)
        return
    lic = db.get_license(key)
    if lic is None:
        await interaction.response.send_message("No such key.", ephemeral=True)
        return
    await interaction.response.send_message(
        f"Key: `{lic['key']}`\n"
        f"Owner: <@{lic['discord_user_id']}>\n"
        f"Status: {_status_line(lic)}\n"
        f"Mismatch attempts: {lic['mismatch_attempts']}\n"
        f"Note: {lic['note'] or '-'}",
        ephemeral=True,
    )


@tree.command(description="[admin] Revoke a license key")
@app_commands.describe(key="The license key to revoke")
async def revoke(interaction: discord.Interaction, key: str):
    if not _require_admin(interaction):
        await interaction.response.send_message("You can't use this command.", ephemeral=True)
        return
    ok = db.revoke_license(key)
    await interaction.response.send_message(
        "Revoked." if ok else "No such key.", ephemeral=True
    )


@tree.command(description="[admin] Unbind a key so it can activate on a new Minecraft account")
@app_commands.describe(key="The license key to unbind")
async def unbind(interaction: discord.Interaction, key: str):
    if not _require_admin(interaction):
        await interaction.response.send_message("You can't use this command.", ephemeral=True)
        return
    ok = db.unbind_license(key)
    await interaction.response.send_message(
        "Unbound — it'll activate on whichever account uses it next." if ok else "No such key.",
        ephemeral=True,
    )


@client.event
async def on_ready():
    guild_id = os.environ.get("DISCORD_GUILD_ID")
    if guild_id:
        guild = discord.Object(id=int(guild_id))
        tree.copy_global_to(guild=guild)
        await tree.sync(guild=guild)
    else:
        await tree.sync()
    print(f"Logged in as {client.user}")
