/** True in the build for the public testnets (VITE_VEASHI_NETWORK=testnet), also before its setup loads. */
export const TESTNET_BUILD = import.meta.env.VITE_VEASHI_NETWORK === "testnet";
