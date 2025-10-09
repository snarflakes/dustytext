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
      const errorMessage = String(error);
      
      // Check for "Object is not food" error
      if (errorMessage.includes('4f626a656374206973206e6f7420666f6f640000000000000000000000000000') ||
          errorMessage.includes('Object is not food')) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `❌ The equipped ${equippedTool?.type || 'item'} is not edible. Equip food items like bread, apples, or cooked meat to eat.`
        }));
        return;
      }
      
      // Check for gas limit error
      if (errorMessage.includes('0x34a44dbe') || 
          errorMessage.includes('gas limit too low')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ You are out of gas. Click Orange Square in the top right corner and "Top Up" Gas.` 
        }));
        return;
      }
      
      // Check for energy error (player is dead)
      if (errorMessage.includes('Entity has no energy') || 
          errorMessage.includes('456e7469747920686173206e6f20656e65726779000000000000000000000000')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `💀 You are dead. Remember your energy depletes every minute (even while away) and more so with every move you make... "Spawn" to be reborn into new life.` 
        }));
        return;
      }

      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `❌ Eat failed: ${error}`
      }));
    }
  }
}
