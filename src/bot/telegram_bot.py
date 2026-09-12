"""Main Telegram bot — aiogram 3.x dispatcher, middleware, long-polling.

Wires together all services (wallet, executor, positions, analytics,
subscriptions) and registers the command router.

Usage::

    bot_app = TelegramBotApp()
    await bot_app.init()
    await bot_app.start()      # blocking — runs long-polling
    await bot_app.shutdown()
"""
from __future__ import annotations

import asyncio
import os
from typing import Any, Awaitable, Callable, Optional

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command
from aiogram.types import TelegramObject, Update, User
from aiogram.utils.keyboard import InlineKeyboardBuilder
from loguru import logger

from src.archives.writer import TradeArchiveWriter
from src.billing.subscription import SubscriptionManager, Tier
from src.config import ArchiveConfig
from src.trading.executor import TradeExecutor
from src.trading.position import PositionTracker, PositionStatus
from src.trading.wallet import WalletManager
from src.analytics.tracker import AnalyticsTracker
from src.bot.handlers.commands import BotContext, router, set_context

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
ADMIN_ID = int(os.getenv("ADMIN_TELEGRAM_ID", "0"))

# --------------------------------------------------------------------------- #
# Middleware
# --------------------------------------------------------------------------- #
class SubscriptionMiddleware:
    """Outer middleware that loads the user's subscription into ``event_context``.

    Attaches ``data["subscription"]`` so handlers can inspect the tier
    without an extra DB call.  Also blocks expired users from most
    commands except /start, /hire, and /help.
    """

    ALLOWED_WHEN_EXPIRED = {"start", "hire", "help", "wallet"}

    def __init__(self, sub_manager: SubscriptionManager) -> None:
        self.sub_manager = sub_manager

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user: Optional[User] = data.get("event_context", {}).get("user") if isinstance(data.get("event_context"), dict) else None
        # aiogram 3.x puts user in data directly
        user = user or data.get("user_from") or data.get("user")
        if user is None:
            return await handler(event, data)

        sub = await self.sub_manager.check_subscription(user.id)
        data["subscription"] = sub

        # Block expired users from most commands
        # (We can't easily inspect the command text here, so we pass the
        #  subscription through and let handlers decide.)
        return await handler(event, data)


class AdminMiddleware:
    """Middleware that sets ``data["is_admin"]`` based on ADMIN_TELEGRAM_ID."""

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = data.get("user_from") or data.get("user")
        data["is_admin"] = (user is not None and user.id == ADMIN_ID)
        return await handler(event, data)


# --------------------------------------------------------------------------- #
# Bot app
# --------------------------------------------------------------------------- #
class TelegramBotApp:
    """Top-level bot application — owns all services and the polling loop.

    Attributes:
        bot:          aiogram ``Bot`` instance
        dp:           aiogram ``Dispatcher``
        subscriptions: SubscriptionManager
        wallets:       WalletManager
        positions:     PositionTracker
        analytics:     AnalyticsTracker
        executor:      TradeExecutor
    """

    def __init__(self, token: str = BOT_TOKEN) -> None:
        if not token:
            raise ValueError("TELEGRAM_BOT_TOKEN not set")

        self.bot = Bot(
            token=token,
            default=DefaultBotProperties(parse_mode=ParseMode.HTML),
        )
        self.dp = Dispatcher()

        # Services
        archive_cfg = ArchiveConfig()
        self.archives = TradeArchiveWriter(
            root=archive_cfg.root,
            engine_live=archive_cfg.engine_live,
        )
        self.subscriptions = SubscriptionManager()
        self.wallets = WalletManager()
        self.positions = PositionTracker()
        self.analytics = AnalyticsTracker()
        self.executor = TradeExecutor(
            wallet_manager=self.wallets,
            position_tracker=self.positions,
            analytics=self.analytics,
            archives=self.archives,
            notify=self._notify_user,
        )

        self._initialised = False

    # --------------------------- lifecycle -------------------------------- #
    async def init(self) -> None:
        """Initialise all services and register routers."""
        logger.info("Initialising bot services…")

        day = self.archives.ensure_day()
        logger.info(
            f"Trade archive day folder (UTC): {day} "
            f"(engine_live={self.archives.engine_live}; empty/zero if no events)"
        )

        await self.analytics.init()
        await self.subscriptions.init()
        await self.executor.init()

        # Start position monitor with exit callback
        self.executor.positions.exit_callback = self._on_position_exit
        await self.positions.start()

        # Wire context into handlers
        ctx = BotContext(
            bot=self.bot,
            subscriptions=self.subscriptions,
            wallets=self.wallets,
            executor=self.executor,
            positions=self.positions,
            analytics=self.analytics,
        )
        set_context(ctx)

        # Register middleware
        self.dp.update.outer_middleware(SubscriptionMiddleware(self.subscriptions))
        self.dp.update.outer_middleware(AdminMiddleware())

        # Register routers
        self.dp.include_router(router)

        me = await self.bot.get_me()
        logger.info(f"Bot @{me.username} initialised")
        self._initialised = True

    async def start(self) -> None:
        """Start long-polling (blocking)."""
        if not self._initialised:
            await self.init()

        logger.info("Starting long-polling…")
        try:
            await self.dp.start_polling(self.bot, allowed_updates=Update.all())
        finally:
            await self.shutdown()

    async def shutdown(self) -> None:
        """Gracefully stop all services."""
        logger.info("Shutting down…")
        await self.positions.stop()
        await self.executor.close()
        await self.wallets.close()
        await self.analytics.close()
        await self.subscriptions.close()
        self.archives.close()
        await self.bot.session.close()
        logger.info("Bot shut down.")

    # --------------------------- callbacks -------------------------------- #
    async def _notify_user(self, user_id: int, message: str) -> None:
        """Send a notification message to a user (used as executor notify)."""
        try:
            await self.bot.send_message(user_id, message)
        except Exception as exc:
            logger.warning(f"Failed to notify user {user_id}: {exc}")

    async def _on_position_exit(self, position: Any, reason: str) -> None:
        """Called by PositionTracker when SL/TP is hit — triggers a sell."""
        logger.info(
            f"Exit triggered for position {position.id[:8]} "
            f"({position.token_symbol}) — reason: {reason}"
        )
        if reason == "stop_loss":
            await self._notify_user(
                position.user_id,
                f"🛑 <b>Stop-Loss triggered</b> — {position.token_symbol}\n"
                f"Current P&L: {position.pnl_pct:+.2f}%",
            )
        elif reason == "take_profit":
            await self._notify_user(
                position.user_id,
                f"💰 <b>Take-Profit hit</b> — {position.token_symbol}\n"
                f"Current P&L: {position.pnl_pct:+.2f}%",
            )

        # Execute the sell
        try:
            await self.executor.execute_sell(
                user_id=position.user_id,
                position_id=position.id,
                reason=reason,
            )
        except Exception as exc:
            logger.error(f"Auto-exit sell failed for {position.id[:8]}: {exc}")
            await self._notify_user(
                position.user_id,
                f"⚠️ Auto-exit failed for {position.token_symbol}: {exc}",
            )


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
async def main() -> None:
    """Async entry point — run the bot until interrupted."""
    app = TelegramBotApp()
    await app.start()


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Bot stopped by user")
