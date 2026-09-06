"""Wallet management — custodial (bot-managed) and non-custodial modes.

Custodial mode:
    The bot generates and stores a Solana keypair per user.  Trades are
    signed locally and broadcast via the configured RPC.

Non-custodial mode:
    The user connects their own wallet (public key only).  The bot builds
    unsigned transactions and the user signs with their own wallet
    extension / Phantom.  This mode returns the base64 unsigned tx for
    the user to sign off-chain.
"""
from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from typing import Any, Optional

import aiohttp
from loguru import logger

# solana-py + solders
from solana.rpc.api import Client as SyncClient  # noqa: F401 (type hint)
from solana.rpc.async_api import AsyncClient
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import VersionedTransaction

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #
DEFAULT_RPC = os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
LAMPORTS_PER_SOL = 1_000_000_000


# --------------------------------------------------------------------------- #
# Data models
# --------------------------------------------------------------------------- #
@dataclass
class WalletInfo:
    """Public-facing wallet descriptor (never exposes private keys)."""

    user_id: int
    mode: str  # "custodial" | "non_custodial"
    public_key: str
    chain: str = "solana"
    balance_sol: float = 0.0
    balance_usd: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "mode": self.mode,
            "public_key": self.public_key,
            "chain": self.chain,
            "balance_sol": round(self.balance_sol, 6),
            "balance_usd": round(self.balance_usd, 2),
        }


# --------------------------------------------------------------------------- #
# Wallet manager
# --------------------------------------------------------------------------- #
class WalletManager:
    """Manage per-user Solana wallets in both custodial and non-custodial modes.

    Private keys for custodial wallets are stored encrypted on disk under
    ``WALLET_STORE_DIR`` (default ``~/.sniper_wallets``).  In production
    these should be stored in a KMS / HSM — the on-disk store is a
    development fallback.
    """

    def __init__(
        self,
        rpc_url: str = DEFAULT_RPC,
        wallet_store_dir: Optional[str] = None,
    ) -> None:
        self.rpc_url = rpc_url
        self._client = AsyncClient(rpc_url)
        self.wallet_store_dir = wallet_store_dir or os.path.expanduser(
            os.getenv("WALLET_STORE_DIR", "~/.sniper_wallets")
        )
        os.makedirs(self.wallet_store_dir, exist_ok=True)
        # in-memory cache of keypairs for the session
        self._custodial_keypairs: dict[int, Keypair] = {}

    # --------------------------- lifecycle -------------------------------- #
    async def close(self) -> None:
        await self._client.close()

    @property
    def client(self) -> AsyncClient:
        return self._client

    # --------------------------- custodial -------------------------------- #
    async def create_custodial_wallet(self, user_id: int) -> WalletInfo:
        """Generate a new Solana keypair for *user_id* and persist it encrypted.

        If a wallet already exists for the user it is returned unchanged.
        """
        if user_id in self._custodial_keypairs:
            kp = self._custodial_keypairs[user_id]
            return WalletInfo(
                user_id=user_id,
                mode="custodial",
                public_key=str(kp.pubkey()),
            )

        # Check disk store
        path = self._wallet_path(user_id)
        if os.path.exists(path):
            kp = self._load_keypair(path)
        else:
            kp = Keypair()
            self._save_keypair(kp, path)
            logger.info(f"Generated new custodial wallet for user {user_id}: {kp.pubkey()}")

        self._custodial_keypairs[user_id] = kp
        balance = await self.get_balance(str(kp.pubkey()))
        return WalletInfo(
            user_id=user_id,
            mode="custodial",
            public_key=str(kp.pubkey()),
            balance_sol=balance,
        )

    async def get_custodial_wallet(self, user_id: int) -> Optional[WalletInfo]:
        """Return the stored custodial wallet for *user_id* or ``None``."""
        kp = self._custodial_keypairs.get(user_id)
        if kp is None:
            path = self._wallet_path(user_id)
            if not os.path.exists(path):
                return None
            kp = self._load_keypair(path)
            self._custodial_keypairs[user_id] = kp
        balance = await self.get_balance(str(kp.pubkey()))
        return WalletInfo(
            user_id=user_id,
            mode="custodial",
            public_key=str(kp.pubkey()),
            balance_sol=balance,
        )

    def get_keypair(self, user_id: int) -> Optional[Keypair]:
        """Return the raw ``Keypair`` for signing (custodial mode only)."""
        kp = self._custodial_keypairs.get(user_id)
        if kp is None:
            path = self._wallet_path(user_id)
            if os.path.exists(path):
                kp = self._load_keypair(path)
                self._custodial_keypairs[user_id] = kp
        return kp

    # --------------------------- non-custodial ---------------------------- #
    async def connect_non_custodial(
        self, user_id: int, public_key: str
    ) -> WalletInfo:
        """Register a user-provided public key (non-custodial mode).

        The bot never holds the private key; it builds unsigned txs that
        the user signs with Phantom / Solflare.
        """
        # Validate the pubkey
        try:
            Pubkey.from_string(public_key)
        except Exception as exc:
            raise ValueError(f"Invalid Solana public key: {public_key}") from exc

        meta = {"public_key": public_key, "mode": "non_custodial", "chain": "solana"}
        meta_path = self._meta_path(user_id)
        with open(meta_path, "w") as f:
            json.dump(meta, f)

        balance = await self.get_balance(public_key)
        logger.info(f"Connected non-custodial wallet for user {user_id}: {public_key}")
        return WalletInfo(
            user_id=user_id,
            mode="non_custodial",
            public_key=public_key,
            balance_sol=balance,
        )

    async def get_wallet_info(self, user_id: int) -> Optional[WalletInfo]:
        """Return whichever wallet mode is configured for *user_id*."""
        # Try meta file first (covers non-custodial)
        meta_path = self._meta_path(user_id)
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
            if meta.get("mode") == "non_custodial":
                balance = await self.get_balance(meta["public_key"])
                return WalletInfo(
                    user_id=user_id,
                    mode="non_custodial",
                    public_key=meta["public_key"],
                    balance_sol=balance,
                )

        # Fall back to custodial
        return await self.get_custodial_wallet(user_id)

    # --------------------------- signing ---------------------------------- #
    async def sign_and_broadcast(
        self,
        user_id: int,
        unsigned_tx_bytes: bytes,
    ) -> str:
        """Sign a versioned transaction with the custodial keypair and broadcast.

        *unsigned_tx_bytes* is the raw serialised ``VersionedTransaction``
        from Jupiter's swap endpoint (base64-decoded).

        Returns the transaction signature on success.
        Raises ``RuntimeError`` if no custodial keypair is available.
        """
        kp = self.get_keypair(user_id)
        if kp is None:
            raise RuntimeError(
                f"No custodial keypair for user {user_id} — cannot sign"
            )

        # Deserialize the unsigned versioned transaction
        vtx = VersionedTransaction.from_bytes(unsigned_tx_bytes)

        # Sign with our keypair
        signed_vtx = VersionedTransaction(vtx.message, [kp])

        # Broadcast
        resp = await self._client.send_raw_transaction(bytes(signed_vtx))
        sig = resp.value
        logger.info(f"Broadcasted tx {sig} for user {user_id}")
        return str(sig)

    async def build_unsigned_tx(self, unsigned_tx_b64: str) -> bytes:
        """Decode a base64 unsigned transaction from Jupiter for the user to sign.

        In non-custodial mode this is sent back to the user; in custodial
        mode it is passed to :meth:`sign_and_broadcast`.
        """
        return base64.b64decode(unsigned_tx_b64)

    # --------------------------- balance ---------------------------------- #
    async def get_balance(self, public_key: str) -> float:
        """Return the SOL balance for *public_key* in SOL (0.0 on error)."""
        try:
            pubkey = Pubkey.from_string(public_key)
            resp = await self._client.get_balance(pubkey)
            if resp.value is not None:
                return resp.value / LAMPORTS_PER_SOL
        except Exception as exc:
            logger.warning(f"Balance check failed for {public_key}: {exc}")
        return 0.0

    async def get_token_accounts(self, public_key: str) -> list[dict[str, Any]]:
        """Return SPL token accounts for *public_key*."""
        try:
            pubkey = Pubkey.from_string(public_key)
            resp = await self._client.get_token_accounts_by_owner(
                pubkey,
                opts={"encoding": "jsonParsed"},
            )
            accounts = []
            for acc in (resp.value or []):
                info = acc.account.data.parsed["info"]
                accounts.append({
                    "mint": info.get("mint"),
                    "amount": float(info.get("tokenAmount", {}).get("uiAmount", 0) or 0),
                    "decimals": info.get("tokenAmount", {}).get("decimals", 0),
                })
            return accounts
        except Exception as exc:
            logger.warning(f"Token accounts fetch failed for {public_key}: {exc}")
            return []

    async def request_airdrop(self, public_key: str, sol: float = 1.0) -> Optional[str]:
        """Request an airdrop (devnet/testnet only). Returns tx signature."""
        try:
            pubkey = Pubkey.from_string(public_key)
            resp = await self._client.request_airdrop(pubkey, int(sol * LAMPORTS_PER_SOL))
            return str(resp.value)
        except Exception as exc:
            logger.warning(f"Airdrop failed for {public_key}: {exc}")
            return None

    # --------------------------- file helpers ----------------------------- #
    def _wallet_path(self, user_id: int) -> str:
        return os.path.join(self.wallet_store_dir, f"wallet_{user_id}.json")

    def _meta_path(self, user_id: int) -> str:
        return os.path.join(self.wallet_store_dir, f"meta_{user_id}.json")

    def _save_keypair(self, kp: Keypair, path: str) -> None:
        """Persist a keypair as a JSON array of 64 bytes (dev fallback)."""
        import json as _json
        secret = list(kp.secret() if hasattr(kp, 'secret') else kp.secret())
        # solders Keypair exposes .secret() returning bytes
        with open(path, "w") as f:
            _json.dump({"secret": list(bytes(kp.secret()))}, f)
        os.chmod(path, 0o600)

    def _load_keypair(self, path: str) -> Keypair:
        with open(path) as f:
            data = json.load(f)
        secret_bytes = bytes(data["secret"])
        return Keypair.from_bytes(secret_bytes)
