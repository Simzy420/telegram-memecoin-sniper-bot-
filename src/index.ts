import { loadConfig } from './config.js';
import { createBot } from './bot.js';
import { SniperEngine } from './sniper/engine.js';
import { SimulatedPriceFeed } from './sniper/simulatedFeed.js';
import { helpText } from './commands.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Dry-run uses the deterministic simulated feed (auto-generates newly seen
  // tokens). A live deployment would swap in a real on-chain PriceFeed here.
  const priceFeed = new SimulatedPriceFeed([], { autoGenerate: true, defaultChain: config.chain });
  const engine = new SniperEngine(config, priceFeed);

  if (!config.telegramBotToken) {
    console.log('No TELEGRAM_BOT_TOKEN set — cannot connect to Telegram.');
    console.log('Run `npm run simulate` to exercise the bot end-to-end locally.\n');
    console.log(helpText);
    return;
  }

  const bot = createBot(config, { engine, config });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  console.log(`Starting Telegram bot in ${config.tradingMode} mode on ${config.chain}...`);
  await bot.launch();
  console.log('Bot stopped.');
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
