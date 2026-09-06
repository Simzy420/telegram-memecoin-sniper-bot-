# 🦍 Big Brain Ape — Telegram Memecoin Sniper Bot

Trades memecoins. Users hire this bot to automatically snipe and trade new memecoin launches on Solana and Base.

## 🚀 Features

- **Auto-snipe new launches** — Detects new token launches on Pump.fun, Raydium, and Uniswap in real-time
- **Rug pull protection** — Multi-layer safety checks before every buy (liquidity, honeypot, creator analysis)
- **Telegram interface** — Users control everything from a Telegram chat
- **Subscription model** — Users pay to hire the bot (Free trial, Basic, Pro, Whale tiers)
- **Non-custodial option** — Users can connect their own wallet
- **Real-time notifications** — Trade alerts, new token alerts, safety warnings
- **Performance analytics** — Win rate, P&L, trade history

## 🏗️ Architecture

```
src/
├── detectors/     # New token launch detection (Pump.fun, Raydium, Uniswap)
├── safety/        # Rug pull detection, honeypot checks, token analysis
├── trading/       # Trade execution, wallet management, stop-loss
├── bot/           # Telegram bot interface, commands, notifications
├── billing/       # Subscription management, payments, access control
├── analytics/     # Performance tracking, stats
├── models/        # Data models (User, Token, Trade, Position)
├── config.py      # Configuration
└── utils/         # Shared utilities
```

## 📋 Development Tasks

See the [GitHub Issues](https://github.com/Simzy420/telegram-memecoin-sniper-bot-/issues) for the full task breakdown.

## 🔧 Setup

```bash
cp .env.example .env
# Edit .env with your keys
pip install -r requirements.txt
python main.py
```

## ⚠️ Disclaimer

This software is for educational purposes. Memecoin trading is extremely high risk. Always do your own research.
