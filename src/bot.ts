import { Telegraf } from 'telegraf';
import type { AppConfig } from './config.js';
import { handleCommand, type CommandContext } from './commands.js';

/**
 * Build a Telegraf bot that routes every text message through the shared,
 * transport-agnostic {@link handleCommand}. Access is optionally restricted to
 * `config.allowedUserIds`.
 */
export function createBot(config: AppConfig, ctx: CommandContext): Telegraf {
  if (!config.telegramBotToken) {
    throw new Error('Cannot create bot without TELEGRAM_BOT_TOKEN');
  }

  const bot = new Telegraf(config.telegramBotToken);

  bot.use(async (context, next) => {
    const userId = context.from?.id;
    if (config.allowedUserIds.length > 0 && (userId === undefined || !config.allowedUserIds.includes(userId))) {
      await context.reply('Unauthorized.');
      return;
    }
    return next();
  });

  bot.on('text', async (context) => {
    const reply = await handleCommand(context.message.text, ctx);
    await context.reply(reply);
  });

  return bot;
}
