import { Chain, http } from "viem";
import { anvil } from "viem/chains";
import { createWagmiConfig } from "@latticexyz/entrykit/internal";
import { garnet, pyrope, redstone } from "@latticexyz/common/chains";
import { chainId } from "./common";

const redstoneWithBundler = {
  ...redstone,
  rpcUrls: {
    ...redstone.rpcUrls,
    bundler: {
      http: redstone.rpcUrls.default.http,
      webSocket: redstone.rpcUrls.default.webSocket,
    },
  },
  contracts: {
    ...redstone.contracts,
    quarryPaymaster: {
      address: "0x2d70F1eFFbFD865764CAF19BE2A01a72F3CE774f",
    },
  },
};

export const chains = [
  redstoneWithBundler,
  garnet,
  pyrope,
  anvil,
] as const satisfies Chain[];

export const transports = {
  [garnet.id]: http(),
  [pyrope.id]: http(),
  [redstoneWithBundler.id]: http("https://rpc.redstonechain.com", {
    timeout: 30_000,
    retryCount: 3,
    retryDelay: 2000
  }),
  [anvil.id]: http(),
} as const;

export const wagmiConfig = createWagmiConfig({
  chainId,
  walletConnectProjectId: "3f1000f6d9e0139778ab719fddba894a",
  appName: "Dust Wallet App",
  chains,
  transports,
  pollingInterval: {
    [garnet.id]: 2000,
    [pyrope.id]: 2000,
    [redstoneWithBundler.id]: 2000,
    [anvil.id]: 1000,
  },
});













