"""The Python swap path must refuse to sign, including when the live gate is armed."""

import unittest

from src.trading.live_gate import broadcast_refusal, live_gate_armed


class LiveGateTest(unittest.TestCase):
    def test_default_is_closed(self) -> None:
        self.assertFalse(live_gate_armed({}))
        text = broadcast_refusal({})
        self.assertIn("No transaction was signed", text)

    def test_true_alone_does_not_arm(self) -> None:
        self.assertFalse(live_gate_armed({"LIVE_TRADING": "true"}))
        self.assertFalse(
            live_gate_armed(
                {
                    "LIVE_TRADING": "TRUE",
                    "LIVE_TRADING_CONFIRM": "I_UNDERSTAND",
                    "WALLET_ENCRYPTION_KEY": "k" * 32,
                }
            )
        )

    def test_armed_gate_still_refuses_broadcast(self) -> None:
        env = {
            "LIVE_TRADING": "true",
            "LIVE_TRADING_CONFIRM": "I_UNDERSTAND",
            "WALLET_ENCRYPTION_KEY": "k" * 32,
        }
        self.assertTrue(live_gate_armed(env))
        text = broadcast_refusal(env)
        self.assertIn("no transaction broadcaster", text)
        self.assertIn("not signed", text)


if __name__ == "__main__":
    unittest.main()
