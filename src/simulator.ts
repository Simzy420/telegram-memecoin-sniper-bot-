import { loadConfig } from './config.js';
import { handleCommand, type CommandContext } from './commands.js';
import { SniperEngine } from './sniper/engine.js';
import { SimulatedPriceFeed } from './sniper/simulatedFeed.js';

/**
 * Local end-to-end runner. Drives the exact same command pipeline the Telegram
 * transport uses, but without connecting to Telegram, so the full flow can be
 * demonstrated without any secrets or funds.
 */
async function main(): Promise<void> {
  const config = { ...loadConfig(), tradingMode: 'dry-run' as const };

  const memeAddress = 'So1aNaMeMeCoInAddr1111111111111111111111111';
  const feed = new SimulatedPriceFeed(
    [SimulatedPriceFeed.defaultToken(memeAddress, 'PEPE', 0.000002, config.chain)],
    { autoGenerate: true, defaultChain: config.chain },
  );
  const engine = new SniperEngine(config, feed);
  const ctx: CommandContext = { engine, config };

  const say = (who: string, text: string): void => {
    const prefix = who === 'user' ? '\n👤 user  > ' : '🤖 bot   | ';
    console.log(prefix + text.replace(/\n/g, '\n         '));
  };

  const run = async (input: string): Promise<void> => {
    say('user', input);
    const reply = await handleCommand(input, ctx);
    say('bot', reply);
  };

  console.log('=== Memecoin Sniper Bot — end-to-end simulation (dry-run) ===');

  await run('/start');
  await run('/status');
  await run('/snipe ' + memeAddress);
  await run('/positions');

  // Simulate the freshly sniped coin pumping +80%, then take profit.
  const pumped = feed.movePrice(memeAddress, 1.8);
  console.log(`\n[market] ${'PEPE'} pumped to ${pumped.toFixed(9)} (+80%)`);

  const position = engine.getPosition(memeAddress);
  if (position) {
    const exit = engine.evaluateExit(position, pumped);
    console.log(`[engine] exit signal: ${exit ?? 'none'}`);
  }

  await run('/sell ' + memeAddress);
  await run('/positions');

  console.log('\n=== Simulation complete ===');
}

main().catch((err) => {
  console.error('Simulation failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
