import { encodeFunctionData, parseAbi } from "viem";
import { CommandHandler, CommandContext } from "./types";

const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";

const eatAbi = parseAbi([
  "function eat(bytes32 caller, (uint16 slot, uint16 amount) slotAmount) returns (bytes32)",
]);

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
        abi: eatAbi,
        functionName: "eat",
        args: [entityId, { slot: equippedTool.slot, amount: 1 }],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `🍽️ Ate 1 ${equippedTool.type} from slot ${equippedTool.slot}. Tx: ${txHash}`
      }));

    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `❌ Eat failed: ${error}`
      }));
    }
  }
}