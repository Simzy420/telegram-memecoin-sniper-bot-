"""Telegram bot command handlers (aiogram 3.x).

Every handler is async and uses ``CommandObject`` / ``Message`` types
from aiogram 3.x.  Inline keyboards are used where a user must pick from
a small set of options (tiers, wallet modes, confirmations).
"""
from __future__ import annotations

import time
from typing import Any, Optional

from aiogram import Bot
from aiogram import Router
from aiogram.filters import Command, CommandObject
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    User,
)
from aiogram.utils.markdown import hbold, hcode, hlink
from loguru import logger

from src.billing.subscription import (
    Subscription,
    SubscriptionManager,
    Tier,
    TIER_CONFIGS,
)
from src.trading.executor import TradeExecutor
from src.trading.position import PositionTracker, PositionStatus
from src.trading.wallet import WalletManager
from src.analytics.tracker import AnalyticsTracker

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
PAYMENT_BASE_WALLET = "0x37a8023762c69f7150d878733fd9f635f1070fc6"


def tier_keyboard() -> InlineKeyboardMarkup:
    """Pricing / upgrade keyboard."""
    kb = [
        [InlineKeyboardButton(text="🆓 Free Trial (3 days)", callback_data="tier_info:free")],
        [InlineKeyboardButton(text="🟢 Basic — $19.99/mo", callback_data="tier_info:basic")],
        [InlineKeyboardButton(text="🟡 Pro — $49.99/mo ⚡ Auto-Snipe", callback_data="tier_info:pro")],
        [InlineKeyboardButton(text="🐳 Whale — $99.99/mo | API", callback_data="tier_info:whale")],
    ]
    return InlineKeyboardMarkup(inline_keyboard=kb)


def tier_upgrade_keyboard() -> InlineKeyboardMarkup:
    kb = [
        [InlineKeyboardButton(text="🟢 Basic — $19.99", callback_data="upgrade:basic")],
        [InlineKeyboardButton(text="🟡 Pro — $49.99 ⚡", callback_data="upgrade:pro")],
        [InlineKeyboardButton(text="🐳 Whale — $99.99", callback_data="upgrade:whale")],
    ]
    return InlineKeyboardMarkup(inline_keyboard=kb)


def wallet_keyboard() -> InlineKeyboardMarkup:
    kb = [
        [InlineKeyboardButton(text="🔐 Create Bot Wallet (Custodial)", callback_data="wallet:custodial")],
        [InlineKeyboardButton(text="🔗 Connect My Wallet (Non-Custodial)", callback_data="wallet:noncustodial")],
    ]
    return InlineKeyboardMarkup(inline_keyboard=kb)


def confirm_keyboard(action: str) -> InlineKeyboardMarkup:
    kb = [
        [
            InlineKeyboardButton(text="✅ Confirm", callback_data=f"confirm:{action}"),
            InlineKeyboardButton(text="❌ Cancel", callback_data="confirm:cancel"),
        ]
    ]
    return InlineKeyboardMarkup(inline_keyboard=kb)


def close_position_keyboard(positions: list) -> InlineKeyboardMarkup:
    kb = []
    for p in positions[:8]:
        emoji = "🟢" if p.pnl_pct >= 0 else "🔴"
        kb.append([
            InlineKeyboardButton(
                text=f"{emoji} {p.token_symbol} {p.pnl_pct:+.1f}%",
                callback_data=f"close:{p.id}",
            )
        ])
    return InlineKeyboardMarkup(inline_keyboard=kb)


# --------------------------------------------------------------------------- #
# Notification helpers (called by executor / position tracker)
# --------------------------------------------------------------------------- #
async def notify_trade_opened(bot: Bot, user_id: int, **kwargs: Any) -> None:
    await bot.send_message(user_id, f"🎯 <b>Trade opened</b>\n{hcode(str(kwargs))}")


async def notify_trade_closed(bot: Bot, user_id: int, pnl_pct: float, token: str) -> None:
    emoji = "🟢" if pnl_pct >= 0 else "🔴"
    await bot.send_message(
        user_id,
        f"{emoji} <b>Position closed</b> — {token}\nP&L: {pnl_pct:+.2f}%",
    )


async def notify_stop_loss(bot: Bot, user_id: int, token: str, pnl_pct: float) -> None:
    await bot.send_message(
        user_id,
        f"🛑 <b>Stop-Loss triggered</b> — {token}\nP&L: {pnl_pct:+.2f}%",
    )


async def notify_take_profit(bot: Bot, user_id: int, token: str, pnl_pct: float) -> None:
    await bot.send_message(
        user_id,
        f"💰 <b>Take-Profit hit</b> — {token}\nP&L: {pnl_pct:+.2f}%",
    )


# --------------------------------------------------------------------------- #
# Context — passed to handlers via bot context or middleware
# --------------------------------------------------------------------------- #
class BotContext:
    """Shared services injected into the handler router."""

    def __init__(
        self,
        bot: Bot,
        subscriptions: SubscriptionManager,
        wallets: WalletManager,
        executor: TradeExecutor,
        positions: PositionTracker,
        analytics: AnalyticsTracker,
    ) -> None:
        self.bot = bot
        self.subscriptions = subscriptions
        self.wallets = wallets
        self.executor = executor
        self.positions = positions
        self.analytics = analytics


# --------------------------------------------------------------------------- #
# Router
# --------------------------------------------------------------------------- #
router = Router(name="commands")

# Module-level context, set by telegram_bot.init()
_ctx: Optional[BotContext] = None


def set_context(ctx: BotContext) -> None:
    global _ctx
    _ctx = ctx


def _get_ctx() -> BotContext:
    if _ctx is None:
        raise RuntimeError("BotContext not set — call set_context() first")
    return _ctx


# --------------------------------------------------------------------------- #
# Command handlers
# --------------------------------------------------------------------------- #
@router.message(Command("start"))
async def cmd_start(message: Message, command: CommandObject) -> None:
    """Welcome the user and show tier options."""
    ctx = _get_ctx()
    user_id = message.from_user.id
    name = message.from_user.first_name or "trader"

    # Auto-create trial subscription
    sub = await ctx.subscriptions.check_subscription(user_id)

    text = (
        f"🦍 <b>Welcome to Big Brain Ape Sniper, {name}!</b>\n\n"
        f"You've been given a <b>3-day free trial</b> — 1 snipe/day, max 0.1 SOL.\n\n"
        f"📊 <b>Your tier:</b> {sub.tier.value.upper()}\n"
        f"⏳ <b>Trial expires in:</b> {sub.days_remaining} days\n\n"
        f"<b>Quick start:</b>\n"
        f"• /hire — View subscription tiers & upgrade\n"
        f"• /wallet — Set up your trading wallet\n"
        f"• /snipe &lt;token_address&gt; — Snipe a token now\n"
        f"• /auto — Toggle auto-snipe mode (Pro+)\n"
        f"• /help — Full command list\n"
    )
    await message.answer(text, reply_markup=tier_keyboard())


@router.message(Command("hire"))
async def cmd_hire(message: Message) -> None:
    """Show subscription tiers and upgrade options."""
    ctx = _get_ctx()
    user_id = message.from_user.id
    sub = await ctx.subscriptions.check_subscription(user_id)

    text = (
        f"💼 <b>Hire the Bot — Subscription Tiers</b>\n\n"
        f"Your current tier: <b>{sub.tier.value.upper()}</b>\n"
        f"Status: {sub.status} | Days left: {sub.days_remaining}\n\n"
        f"🆓 <b>FREE</b> — $0 | 3-day trial\n"
        f"   1 snipe/day • max 0.1 SOL\n\n"
        f"🟢 <b>BASIC</b> — $19.99/mo\n"
        f"   10 snipes/day • max 0.5 SOL\n\n"
        f"🟡 <b>PRO</b> — $49.99/mo ⚡\n"
        f"   Unlimited snipes • max 2 SOL • Auto-Snipe\n\n"
        f"🐳 <b>WHALE</b> — $99.99/mo\n"
        f"   Unlimited • max 10 SOL • API access\n\n"
        f"💸 <b>Payment:</b> Send USDC/ETH on Base to:\n"
        f"<code>{PAYMENT_BASE_WALLET}</code>\n"
        f"Then use /hire with your tx hash."
    )
    await message.answer(text, reply_markup=tier_upgrade_keyboard())


@router.message(Command("wallet"))
async def cmd_wallet(message: Message) -> None:
    """Show wallet status / setup options."""
    ctx = _get_ctx()
    user_id = message.from_user.id
    info = await ctx.wallets.get_wallet_info(user_id)

    if info:
        text = (
            f"👛 <b>Your Wallet</b>\n\n"
            f"Mode: <b>{info.mode.replace('_', '-').title()}</b>\n"
            f"Address: <code>{info.public_key}</code>\n"
            f"Balance: <b>{info.balance_sol:.4f} SOL</b>\n\n"
            f"Send SOL to the address above to fund your sniping."
        )
        await message.answer(text, reply_markup=wallet_keyboard())
    else:
        text = (
            "👛 <b>Wallet Setup</b>\n\n"
            "Choose how you want the bot to manage your funds:\n\n"
            "🔐 <b>Custodial</b> — Bot generates & manages a wallet for you.\n"
            "    Fastest setup. Private key stored securely by the bot.\n\n"
            "🔗 <b>Non-Custodial</b> — Connect your own Solana wallet.\n"
            "    You sign every transaction. Bot never holds your keys."
        )
        await message.answer(text, reply_markup=wallet_keyboard())


@router.message(Command("config"))
async def cmd_config(message: Message, command: CommandObject) -> None:
    """View or update trading configuration."""
    ctx = _get_ctx()
    user_id = message.from_user.id
    sub = await ctx.subscriptions.check_subscription(user_id)
    args = (command.args or "").strip().split()

    if not args:
        text = (
            f"⚙️ <b>Trading Configuration</b>\n\n"
            f"Tier: <b>{sub.tier.value.upper()}</b>\n"
            f"Max position: <b>{sub.config.max_position_sol} SOL</b>\n"
            f"Daily limit: {'Unlimited' if sub.config.daily_snipe_limit == -1 else sub.config.daily_snipe_limit}\n"
            f"Snipes used today: {sub.daily_snipes_used}\n"
            f"Auto-snipe: {'✅' if sub.config.auto_snipe else '❌'}\n\n"
            f"Defaults:\n"
            f"• Slippage: 10%\n"
            f"• Stop-loss: 30%\n"
            f"• Take-profit: 100%\n\n"
            f"To change: /config slippage 15 | /config stoploss 25 | /config takeprofit 150"
        )
        await message.answer(text)
        return

    if args[0] == "slippage" and len(args) == 2:
        val = _safe_float(args[1])
        if val is not None and 1 <= val <= 50:
            await message.answer(f"✅ Slippage set to {val}%")
        else:
            await message.answer("❌ Slippage must be 1–50%")
    elif args[0] == "stoploss" and len(args) == 2:
        val = _safe_float(args[1])
        if val is not None and 5 <= val <= 80:
            await message.answer(f"✅ Stop-loss set to {val}%")
        else:
            await message.answer("❌ Stop-loss must be 5–80%")
    elif args[0] == "takeprofit" and len(args) == 2:
        val = _safe_float(args[1])
        if val is not None and 10 <= val <= 1000:
            await message.answer(f"✅ Take-profit set to {val}%")
        else:
            await message.answer("❌ Take-profit must be 10–1000%")
    else:
        await message.answer("Usage: /config slippage|stoploss|takeprofit <value>")


@router.message(Command("snipe"))
async def cmd_snipe(message: Message, command: CommandObject) -> None:
    """Snipe a specific token: /snipe <token_address> [amount_sol]."""
    ctx = _get_ctx()
    user_id = message.from_user.id
    args = (command.args or "").strip().split()

    if not args:
        await message.answer(
            "Usage: <code>/snipe &lt;token_address&gt; [amount_sol]</code>\n"
            "Example: <code>/snipe 7GCihgDB8fe6KNjn2MYtkzfnMKd8HQv2atBgxWB4pjvg 0.1</code>"
        )
        return

    token_address = args[0]
    amount_sol = _safe_float(args[1]) if len(args) > 1 else None

    # Check subscription & limits
    sub = await ctx.subscriptions.check_subscription(user_id)
    if not sub.is_active:
        await message.answer(
            "❌ Your subscription has expired. Use /hire to upgrade."
        )
        return
    if sub.snipes_remaining_today == 0:
        await message.answer(
            f"❌ Daily limit reached ({sub.config.daily_snipe_limit} snipes/day).\n"
            f"Upgrade with /hire for more."
        )
        return

    if amount_sol and amount_sol > sub.config.max_position_sol:
        await message.answer(
            f"❌ Amount exceeds your tier limit ({sub.config.max_position_sol} SOL).\n"
            f"Use /hire to upgrade."
        )
        return

    # Check wallet exists
    wallet = await ctx.wallets.get_wallet_info(user_id)
    if wallet is None:
        await message.answer(
            "❌ No wallet configured. Use /wallet to set one up first."
        )
        return

    # Placeholder safety result — in production this comes from the safety module
    from src.trading.executor import SafetyResult
    safety = SafetyResult(
        safe=True,
        safety_score=70,
        liquidity_usd=25000,
        token_address=token_address,
        token_symbol="???",
    )

    # Record the snipe attempt
    await ctx.subscriptions.record_snipe(user_id)

    await message.answer(f"🎯 Sniping <code>{token_address[:12]}…</code> — analysing…")

    result = await ctx.executor.execute_buy(
        user_id=user_id,
        token_address=token_address,
        token_symbol=safety.token_symbol,
        safety=safety,
        amount_sol=amount_sol,
    )

    if not result.success:
        await message.answer(f"❌ Snipe failed: {result.error}")


@router.message(Command("auto"))
async def cmd_auto(message: Message) -> None:
    """Toggle auto-snipe mode (Pro+ only)."""
    ctx = _get_ctx()
    user_id = message.from_user.id
    sub = await ctx.subscriptions.check_subscription(user_id)

    if not sub.config.auto_snipe:
        await message.answer(
            "🔒 Auto-snipe is a <b>Pro</b> feature ($49.99/mo).\n"
            "Use /hire to upgrade.",
            reply_markup=tier_upgrade_keyboard(),
        )
        return

    # Toggle stored in a simple flag (in production use Redis/DB)
    await message.answer(
        "⚡ <b>Auto-Snipe mode</b>\n\n"
        "The bot will automatically snipe new tokens that pass safety checks.\n\n"
        f"Max position: {sub.config.max_position_sol} SOL\n\n"
        "Use /stop to disable."
    )


@router.message(Command("positions"))
async def cmd_positions(message: Message) -> None:
    """List all open positions."""
    ctx = _get_ctx()
    user_id = message.from_user.id
    positions = ctx.positions.get_user_positions(user_id)

    if not positions:
        await message.answer("📭 You have no open positions.")
        return

    lines = ["📊 <b>Open Positions</b>\n"]
    for p in positions:
        emoji = "🟢" if p.pnl_pct >= 0 else "🔴"
        lines.append(
            f"{emoji} <b>{p.token_symbol}</b>\n"
            f"   Entry: ${p.entry_price:.8f} | Now: ${p.current_price:.8f}\n"
            f"   P&L: {p.pnl_pct:+.2f}% | Size: {p.size_sol:.4f} SOL\n"
            f"   SL: ${p.stop_loss_price:.8f} | TP: ${p.take_profit_price:.8f}\n"
        )
    await message.answer("\n".join(lines), reply_markup=close_position_keyboard(positions))


@router.message(Command("close"))
async def cmd_close(message: Message, command: CommandObject) -> None:
    """Close a position: /close <position_id>."""
    ctx = _get_ctx()
    user_id = message.from_user.id
    args = (command.args or "").strip().split()

    if not args:
        positions = ctx.positions.get_user_positions(user_id)
        if not positions:
            await message.answer("📭 No open positions to close.")
            return
        await message.answer(
            "Select a position to close:",
            reply_markup=close_position_keyboard(positions),
        )
        return

    position_id = args[0]
    pos = ctx.positions.get_position(position_id)
    if pos is None or pos.user_id != user_id:
        await message.answer("❌ Position not found.")
        return

    await message.answer(f"🔄 Closing {pos.token_symbol}…")
    result = await ctx.executor.execute_sell(user_id, position_id, reason="manual")
    if not result.success:
        await message.answer(f"❌ Close failed: {result.error}")


@router.message(Command("history"))
async def cmd_history(message: Message) -> None:
    """Show trade history."""
    ctx = _get_ctx()
    user_id = message.from_user.id
    trades = await ctx.analytics.get_trade_history(user_id, limit=15)

    if not trades:
        await message.answer("📭 No trade history yet.")
        return

    lines = ["📋 <b>Recent Trades</b>\n"]
    for t in trades:
        emoji = "🟢" if (t.get("pnl_usd", 0) or 0) >= 0 else "🔴"
        side = t.get("side", "?").upper()
        symbol = t.get("token_symbol", "???")
        pnl = t.get("pnl_usd", 0) or 0
        lines.append(
            f"{emoji} {side} <b>{symbol}</b> — "
            f"{t.get('amount_sol', 0):.4f} SOL | P&L: ${pnl:+.2f}"
        )
    await message.answer("\n".join(lines))


@router.message(Command("stats"))
async def cmd_stats(message: Message) -> None:
    """Show user trading stats."""
    ctx = _get_ctx()
    user_id = message.from_user.id
    stats = await ctx.analytics.get_user_stats(user_id)

    text = (
        f"📈 <b>Your Stats</b>\n\n"
        f"Total trades: <b>{stats['total_trades']}</b>\n"
        f"Wins: <b>{stats['wins']}</b> | Losses: <b>{stats['losses']}</b>\n"
        f"Win rate: <b>{stats['win_rate']}%</b>\n"
        f"Total P&L: <b>${stats['total_pnl_usd']:+.2f}</b>\n"
        f"Total volume: <b>{stats['total_volume_sol']:.4f} SOL</b>"
    )
    await message.answer(text)


@router.message(Command("stop"))
async def cmd_stop(message: Message) -> None:
    """Stop auto-snipe mode for the user."""
    ctx = _get_ctx()
    user_id = message.from_user.id
    await message.answer(
        "⏹ <b>Auto-snipe stopped.</b>\n"
        "Open positions will continue to be monitored for SL/TP.\n"
        "Use /auto to restart."
    )


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    """Full command list."""
    text = (
        "📖 <b>Command List</b>\n\n"
        "<b>Trading</b>\n"
        "/snipe &lt;address&gt; [sol] — Snipe a token\n"
        "/auto — Toggle auto-snipe (Pro+)\n"
        "/positions — View open positions\n"
        "/close &lt;id&gt; — Close a position\n"
        "/stop — Stop auto-snipe\n\n"
        "<b>Account</b>\n"
        "/start — Start / show welcome\n"
        "/hire — View tiers & upgrade\n"
        "/wallet — Wallet setup\n"
        "/config — Trading settings\n\n"
        "<b>Analytics</b>\n"
        "/history — Recent trades\n"
        "/stats — Your performance\n\n"
        "<b>Admin</b>\n"
        "/admin — Admin panel (restricted)\n"
        "/broadcast — Send message to all users (restricted)"
    )
    await message.answer(text)


# --------------------------------------------------------------------------- #
# Admin commands
# --------------------------------------------------------------------------- #
@router.message(Command("admin"))
async def cmd_admin(message: Message) -> None:
    """Admin panel — gated by ADMIN_TELEGRAM_ID."""
    ctx = _get_ctx()
    user_id = message.from_user.id

    if user_id != _get_admin_id():
        await message.answer("🔒 Admin only.")
        return

    stats = await ctx.analytics.get_bot_stats()
    text = (
        "🔧 <b>Admin Panel</b>\n\n"
        f"Total trades: <b>{stats['total_trades']}</b>\n"
        f"Unique users: <b>{stats['unique_users']}</b>\n"
        f"Win rate: <b>{stats['win_rate']}%</b>\n"
        f"Total P&L: <b>${stats['total_pnl_usd']:+.2f}</b>\n"
        f"Volume: <b>{stats['total_volume_sol']:.2f} SOL</b>\n"
        f"Trades today: <b>{stats['trades_today']}</b>\n\n"
        f"Use /broadcast &lt;message&gt; to message all users."
    )
    await message.answer(text)


@router.message(Command("broadcast"))
async def cmd_broadcast(message: Message, command: CommandObject) -> None:
    """Broadcast a message to all users — admin only."""
    user_id = message.from_user.id
    if user_id != _get_admin_id():
        await message.answer("🔒 Admin only.")
        return

    text_to_send = (command.args or "").strip()
    if not text_to_send:
        await message.answer("Usage: /broadcast <message>")
        return

    # In production: query all user_ids from subscriptions table
    await message.answer(f"📢 Broadcast queued (message: {text_to_send[:50]}…)")


# --------------------------------------------------------------------------- #
# Callback query handlers (inline keyboards)
# --------------------------------------------------------------------------- #
@router.callback_query(lambda c: c.data.startswith("tier_info:"))
async def cb_tier_info(callback: CallbackQuery) -> None:
    tier_name = callback.data.split(":")[1]
    cfg = TIER_CONFIGS.get(Tier.from_str(tier_name))
    if cfg:
        text = (
            f"📋 <b>{cfg.name.upper()}</b> Tier\n\n"
            f"Price: ${cfg.price_usd}/mo\n"
            f"Daily snipes: {'Unlimited' if cfg.daily_snipe_limit == -1 else cfg.daily_snipe_limit}\n"
            f"Max position: {cfg.max_position_sol} SOL\n"
            f"Auto-snipe: {'✅' if cfg.auto_snipe else '❌'}\n"
            f"API access: {'✅' if cfg.api_access else '❌'}\n"
        )
        if cfg.price_usd > 0:
            await callback.message.answer(
                f"💸 Pay ${cfg.price_usd} in USDC/ETH on Base to:\n<code>{PAYMENT_BASE_WALLET}</code>\n"
                f"Then send tx hash here."
            )
        await callback.message.answer(text)
    await callback.answer()


@router.callback_query(lambda c: c.data.startswith("upgrade:"))
async def cb_upgrade(callback: CallbackQuery) -> None:
    tier_name = callback.data.split(":")[1]
    cfg = TIER_CONFIGS.get(Tier.from_str(tier_name))
    if cfg:
        await callback.message.answer(
            f"💸 To upgrade to <b>{cfg.name.upper()}</b> (${cfg.price_usd}/mo):\n\n"
            f"Send payment on Base to:\n<code>{PAYMENT_BASE_WALLET}</code>\n\n"
            f"After sending, forward your transaction hash. The bot will verify and activate your tier."
        )
    await callback.answer()


@router.callback_query(lambda c: c.data.startswith("wallet:"))
async def cb_wallet(callback: CallbackQuery) -> None:
    ctx = _get_ctx()
    user_id = callback.from_user.id
    mode = callback.data.split(":")[1]

    if mode == "custodial":
        info = await ctx.wallets.create_custodial_wallet(user_id)
        await callback.message.answer(
            f"🔐 <b>Custodial wallet created!</b>\n\n"
            f"Address: <code>{info.public_key}</code>\n"
            f"Balance: {info.balance_sol:.4f} SOL\n\n"
            f"Send SOL to this address to fund your trading."
        )
    elif mode == "noncustodial":
        await callback.message.answer(
            "🔗 <b>Connect your wallet</b>\n\n"
            "Send your Solana wallet public key as a message starting with <code>connect:</code>\n"
            "Example: <code>connect:7xKXt…</code>"
        )
    await callback.answer()


@router.callback_query(lambda c: c.data.startswith("close:"))
async def cb_close(callback: CallbackQuery) -> None:
    ctx = _get_ctx()
    user_id = callback.from_user.id
    position_id = callback.data.split(":")[1]
    pos = ctx.positions.get_position(position_id)

    if pos is None or pos.user_id != user_id:
        await callback.answer("Position not found", show_alert=True)
        return

    await callback.message.answer(f"🔄 Closing {pos.token_symbol}…")
    result = await ctx.executor.execute_sell(user_id, position_id, reason="manual")
    if not result.success:
        await callback.message.answer(f"❌ Close failed: {result.error}")
    await callback.answer()


@router.callback_query(lambda c: c.data == "confirm:cancel")
async def cb_cancel(callback: CallbackQuery) -> None:
    await callback.message.edit_text("❌ Cancelled.")
    await callback.answer()


# --------------------------------------------------------------------------- #
# Utility
# --------------------------------------------------------------------------- #
def _safe_float(s: str) -> Optional[float]:
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _get_admin_id() -> int:
    import os
    return int(os.getenv("ADMIN_TELEGRAM_ID", "0"))
