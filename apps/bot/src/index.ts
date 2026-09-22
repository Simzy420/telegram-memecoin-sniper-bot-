import http from "node:http";
import { Bot, webhookCallback } from "grammy";
import { assertRuntimeConfig, config } from "./config.js";
import { migrate, userStoreKind } from "./db/users.js";
import { registerHandlers } from "./handlers/commands.js";
import { startNightlyLearn } from "./team/nightly.js";
import { isLearnPollPath, writeLearnPoll } from "./team/learn-http.js";
import { durableDbPath, journalRoot } from "./team/paths.js";

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
  { command: "learn", description: "Journal win rate, expectancy, Shield blocks" },
  { command: "export", description: "Export the journal as CSV and JSONL" },
];

function webhookPath(): string {
  if (process.env.WEBHOOK_PATH?.trim()) return process.env.WEBHOOK_PATH.trim();
  if (process.env.WEBHOOK_URL?.trim()) {
    try {
      const pathname = new URL(process.env.WEBHOOK_URL).pathname;
      return pathname && pathname !== "/" ? pathname : "/telegram/webhook";
    } catch {
      return "/telegram/webhook";
    }
  }
  return "/telegram/webhook";
}

function listenHttp(bot: Bot | null): void {
  const port = Number(process.env.PORT ?? "0");
  if (!Number.isFinite(port) || port <= 0) return;
  const hook = webhookPath();
  const useWebhook = Boolean(process.env.WEBHOOK_URL?.trim()) && bot != null;
  const handleUpdate =
    useWebhook && bot
      ? webhookCallback(bot, "http", {
          secretToken: process.env.WEBHOOK_SECRET || undefined,
        })
      : null;
  http
    .createServer((req, res) => {
      const url = req.url ?? "/";
      const pathname = url.split("?")[0] ?? "/";
      if (handleUpdate && req.method === "POST" && pathname === hook) {
        void handleUpdate(req, res).catch((err) => {
          console.error("[bba] webhook error", err instanceof Error ? err.message : "error");
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
            res.end("error");
          }
        });
        return;
      }
      if (req.method === "GET" && isLearnPollPath(pathname)) {
        writeLearnPoll(req, res);
        return;
      }
      if (req.method === "GET" && (pathname === "/" || pathname === "/health")) {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(pathname === "/health" ? "ok" : "Big Brain Ape The MemeCoin Sniper");
        return;
      }
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    })
    .listen(port, () => {
      console.log(
        `[bba] http listening on :${port}${useWebhook ? ` webhook ${hook}` : " health"}`,
      );
    });
}

function maybeNightly(bot: Bot): void {
  if (process.env.LEARN_NIGHTLY !== "true") return;
  if (!process.env.LEARN_CHAT_ID?.trim()) {
    console.warn("[bba] LEARN_NIGHTLY=true but LEARN_CHAT_ID is empty. Nightly summary stays off.");
    return;
  }
  const chatId = process.env.LEARN_CHAT_ID.trim();
  startNightlyLearn({
    send: (text) => bot.api.sendMessage(chatId, text),
  });
  console.log("[bba] nightly journal summary armed. Chat id not printed.");
}

async function main(): Promise<void> {
  assertRuntimeConfig();
  console.log(`[bba] durable db ${durableDbPath()}`);
  console.log(`[bba] journal ${journalRoot()}/days/YYYY-MM-DD/events.jsonl`);

  try {
    await migrate();
    console.log(`[bba] user store: ${userStoreKind()}`);
  } catch (err) {
    console.warn(
      "[bba] database migrate failed — wallet rows stay in memory until Postgres or SQLite is writable.",
      err instanceof Error ? err.message : "error",
    );
  }

  if (!config.telegramToken) {
    listenHttp(null);
    console.log(
      "[snipr] Set TELEGRAM_BOT_TOKEN in .env to start polling. Scaffold is ready.",
    );
    return;
  }

  const bot = new Bot(config.telegramToken);
  registerHandlers(bot);
  maybeNightly(bot);

  bot.catch((err) => {
    console.error("[bba] bot error", err);
  });

  try {
    await bot.api.setMyCommands(COMMANDS);
  } catch (err) {
    console.warn("[bba] setMyCommands failed", err instanceof Error ? err.message : "error");
  }

  if (process.env.WEBHOOK_URL?.trim()) {
    listenHttp(bot);
    try {
      await bot.api.setWebhook(process.env.WEBHOOK_URL.trim(), {
        secret_token: process.env.WEBHOOK_SECRET || undefined,
      });
      console.log(`[bba] ${config.botName} webhook set. Broadcast off. Secret not printed.`);
    } catch (err) {
      console.error(
        "[bba] setWebhook failed",
        err instanceof Error ? err.message : "error",
      );
    }
    return;
  }

  listenHttp(bot);
  console.log(`[bba] ${config.botName} polling… paper desk, broadcast off`);
  await bot.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
