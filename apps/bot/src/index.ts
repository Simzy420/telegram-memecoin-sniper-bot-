import http from "node:http";
import { Bot } from "grammy";
import { assertRuntimeConfig, config } from "./config.js";
import { migrate, userStoreKind } from "./db/users.js";
import { registerHandlers } from "./handlers/commands.js";

const COMMANDS = [
  { command: "start", description: "Meet Big Brain Ape and the troop" },
  { command: "hire", description: "Hire Scout, Sniper, Pulse, Ledger, Shield" },
  { command: "watch", description: "Watch the paper tape" },
  { command: "status", description: "Desk status and paper book" },
  { command: "paper", description: "Paper positions and journal" },
  { command: "help", description: "How to talk to the team" },
  { command: "scout", description: "Ask Scout for candidates" },
  { command: "sniper", description: "Ask Sniper about a paper entry" },
  { command: "pulse", description: "Ask Pulse for a tape read" },
  { command: "ledger", description: "Ask Ledger for the book" },
  { command: "shield", description: "Ask Shield for a safety check" },
];

function listenHealth(): void {
  const port = Number(process.env.PORT ?? "0");
  if (!Number.isFinite(port) || port <= 0) return;
  http
    .createServer((req, res) => {
      const body =
        req.url === "/health" ? "ok" : "Big Brain Ape The MemeCoin Sniper";
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(body);
    })
    .listen(port, () => {
      console.log(`[bba] health listening on :${port}`);
    });
}

async function main(): Promise<void> {
  assertRuntimeConfig();
  listenHealth();

  try {
    await migrate();
    console.log(`[bba] user store: ${userStoreKind()}`);
  } catch (err) {
    console.warn(
      "[bba] database migrate failed — wallet rows stay in memory until Postgres is up.",
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
    console.error("[bba] bot error", err);
  });

  try {
    await bot.api.setMyCommands(COMMANDS);
  } catch (err) {
    console.warn("[bba] setMyCommands failed", err);
  }

  console.log(`[bba] ${config.botName} polling… paper desk, broadcast off`);
  await bot.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
