import asyncio
import os

from dotenv import load_dotenv

load_dotenv()

import uvicorn

import bot
import db
from api import app as api_app


async def main():
    db.init_db()

    port = int(os.environ.get("HTTP_PORT", "8000"))
    config = uvicorn.Config(api_app, host="0.0.0.0", port=port, log_level="info")
    server = uvicorn.Server(config)

    token = os.environ["DISCORD_BOT_TOKEN"]

    await asyncio.gather(
        server.serve(),
        bot.client.start(token),
    )


if __name__ == "__main__":
    asyncio.run(main())
