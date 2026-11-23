/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "testnet" builds the static site against config/testnet.json; anything else loads /devnet.json. */
  readonly VITE_VEASHI_NETWORK?: string;
  /** Optional https RPC overrides for a testnet build. */
  readonly VITE_VEASHI_FOREIGN_RPC?: string;
  readonly VITE_VEASHI_HOME_RPC?: string;
}
