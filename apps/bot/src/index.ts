import { Bot } from "grammy";
import { assertRuntimeConfig, config } from "./config.js";
import { migrate } from "./db/users.js";
import { registerHandlers } from "./handlers/commands.js";

async function main(): Promise<void> {
  assertRuntimeConfig();

  try {
    await migrate();
    console.log("[snipr] database migrated");
  } catch (err) {
    console.warn(
      "[snipr] database migrate failed — start Postgres or fix DATABASE_URL.",
      err,
    );
  }

  if (!config.telegramToken) {
    console.log(
      "[snipr] Set TELEGRAM_BOT_TOKEN in .env to start polling. Scaffold is ready.",
    );
    return;
  }

  const bot = new Bot(config.telegramToken);
  registerHandlers(bot);

  bot.catch((err) => {
    console.error("[snipr] bot error", err);
  });

  console.log(`[snipr] ${config.botName} bot starting…`);
  await bot.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
