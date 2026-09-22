"""Live-trading gate for the unfinished Python executor.

The desk users run is the TypeScript bot. This module makes sure the Python
swap path cannot sign or broadcast. The gate can report "armed" for ops, and
broadcast_refusal() is still always a refusal in this build.
"""

from __future__ import annotations

import os

CONFIRM = "I_UNDERSTAND"
_PLACEHOLDER_MARKERS = ("change-me", "changeme", "dev-only", "placeholder")


def encryption_key_ready(value: str | None) -> bool:
    if not value:
        return False
    key = value.strip()
    if len(key) < 32:
        return False
    lowered = key.lower()
    return not any(marker in lowered for marker in _PLACEHOLDER_MARKERS)


def live_gate_armed(env: dict[str, str] | None = None) -> bool:
    source = env if env is not None else os.environ
    return (
        source.get("LIVE_TRADING") == "true"
        and source.get("LIVE_TRADING_CONFIRM") == CONFIRM
        and encryption_key_ready(source.get("WALLET_ENCRYPTION_KEY"))
    )


def broadcast_refusal(env: dict[str, str] | None = None) -> str:
    """Always explain why no transaction was signed. Never returns an empty string."""
    if not live_gate_armed(env):
        return (
            "Live gate is closed. LIVE_TRADING must be the exact string true, "
            "LIVE_TRADING_CONFIRM must be I_UNDERSTAND, and WALLET_ENCRYPTION_KEY "
            "must be a backed-up 32+ character secret. No transaction was signed."
        )
    return (
        "Live gate is armed, but this build has no transaction broadcaster. "
        "The order was not signed and was not sent."
    )
