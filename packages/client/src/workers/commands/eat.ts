import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

interface EquippedTool {
  slot: number;
  type: string;
  name: string;
}

export class EatCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      const entityId = encodePlayerEntityId(context.address);

      // Check for equipped item
      const equippedTool = (globalThis as typeof globalThis & { equippedTool: EquippedTool | null }).equippedTool;
      
      if (!equippedTool) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ No item equipped to eat. Use 'equip <food item>' first."
        }));
        return;
      }

      // Eat 1 of the equipped item
      const data = encodeFunctionData({
        abi: IWorldAbi,
        functionName: "eat",
        args: [entityId, { slot: equippedTool.slot, amount: 1 }],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `🍽️ You hungrily ate 1 ${equippedTool.type}, wiping your mouth with the back of your hand. Tx: ${txHash}`
      }));

    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `❌ Eat failed: ${error}`
      }));
    }
  }
}