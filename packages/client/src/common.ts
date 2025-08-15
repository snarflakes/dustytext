import mudConfig from "contracts/mud.config";
import { chains } from "./wagmiConfig";
import { Chain } from "viem";

export const chainId = 690; // Hardcoded for now
export const worldAddress = import.meta.env.VITE_WORLD_ADDRESS || "0x253eb85B3C953bFE3827CC14a151262482E7189C";
export const startBlock = BigInt(import.meta.env.VITE_START_BLOCK || "21032222");

export const url = new URL(window.location.href);

export type Direction = (typeof mudConfig.enums.Direction)[number];

export function getWorldAddress() {
  if (!worldAddress) {
    throw new Error("No world address configured. Is the world still deploying?");
  }
  return worldAddress as `0x${string}`;
}

export function getChain(): Chain {
  const chain = chains.find((c) => c.id === chainId);
  if (!chain) {
    throw new Error(`No chain configured for chain ID ${chainId}.`);
  }
  return chain;
}





