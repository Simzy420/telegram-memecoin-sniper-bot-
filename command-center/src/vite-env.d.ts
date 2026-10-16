/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_IMAGE_PROXY?: string;
  readonly VITE_CHAT_API_BASE?: string;
  readonly VITE_CHAT_MOCK?: string;
  /** Optional CoinGecko-compatible root. Unset uses the public API. */
  readonly VITE_MARKET_API_BASE?: string;
  /**
   * Optional snapshot-bridge origin. Unset follows the chat Space.
   * Never put a Robinhood token or ROBINHOOD_BRIDGE_SECRET here.
   */
  readonly VITE_ROBINHOOD_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
