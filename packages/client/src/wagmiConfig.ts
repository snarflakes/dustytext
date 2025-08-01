import { Chain, http, webSocket } from "viem";
import { anvil } from "viem/chains";
import { createWagmiConfig } from "@latticexyz/entrykit/internal";
import { garnet, pyrope, redstone } from "@latticexyz/common/chains";
import { chainId } from "./common";

const redstoneWithPaymaster = {
  ...redstone,
  rpcUrls: {
    ...redstone.rpcUrls,
    wiresaw: {
      http: ["https://wiresaw.redstonechain.com"],
      webSocket: ["wss://wiresaw.redstonechain.com"],
    },
    bundler: {
      http: ["https://rpc.redstonechain.com"],
      webSocket: ["wss://rpc.redstonechain.com"],
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
  redstoneWithPaymaster,
  garnet,
  pyrope,
  anvil, // Added temporarily to prevent errors
] as const satisfies Chain[];

export const transports = {
  [garnet.id]: http(),
  [pyrope.id]: http(),
  [redstoneWithPaymaster.id]: http("https://rpc.redstonechain.com"),
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
    [redstoneWithPaymaster.id]: 2000,
    [anvil.id]: 1000,
  },
});



