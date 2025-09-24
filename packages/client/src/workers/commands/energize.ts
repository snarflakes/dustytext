// energize.ts
import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { getForceFieldInfoForPlayer, invalidateForceFieldFragment } from "./sense";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

function isZero32(x?: `0x${string}` | null) {
  return !x || /^0x0+$/.test(x);
}

interface EquippedTool {
  slot: number;
  type: string;
  name: string;
}

export class EnergizeCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      // Amount: default 1, clamp to uint16
      const amountRaw = args[0] ? Number(args[0]) : 1;
      const amount =
        Number.isFinite(amountRaw) && amountRaw > 0
          ? Math.min(Math.max(1, Math.floor(amountRaw)), 65535)
          : 1;

      // Need an equipped item (batteries). We rely on your global from equip.ts
      const equippedTool =
        (globalThis as typeof globalThis & { equippedTool: EquippedTool | null }).equippedTool;

      if (!equippedTool) {
        window.dispatchEvent(
          new CustomEvent<string>("worker-log", {
            detail: "❌ No item equipped. Use `equip batteries` (or a battery item) first.",
          }),
        );
        return;
      }

      // Optional friendly hint if the equipped item doesn't look like batteries
      if (!/batter/i.test(equippedTool.type)) {
        window.dispatchEvent(
          new CustomEvent<string>("worker-log", {
            detail: `ℹ️ Equipped "${equippedTool.type}". The tx will still try, but the slot must contain Batteries or it will revert.`,
          }),
        );
      }

      // Find the force field station (machine) for the player's current fragment
      const info = await getForceFieldInfoForPlayer(context.address);

      if (isZero32(info.forceField)) {
        window.dispatchEvent(
          new CustomEvent<string>("worker-log", {
            detail: "❌ No Force Field Station found for this fragment. Place/build one first.",
          }),
        );
        return;
      }

      // Build calldata to call World -> MachineSystem.energizeMachine(...)
      const callerEntityId = encodePlayerEntityId(context.address);
      const machineId = info.forceField; // the station's entityId

      const data = encodeFunctionData({
        abi: IWorldAbi,
        functionName: "energizeMachine",
        args: [
          callerEntityId,
          machineId,
          [{ slot: equippedTool.slot, amount }], // use currently equipped slot
          "0x", // extraData empty
        ],
      });

      window.dispatchEvent(
        new CustomEvent<string>("worker-log", {
          detail: `🔋 Energizing Force Field Station with ${amount} from slot ${equippedTool.slot}...`,
        }),
      );

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        // gas is a guess; your RPC may auto-estimate if omitted.
        gas: 500_000n,
      });

      // Invalidate sense cache for this fragment so follow-up `sense` reflects new energy immediately
      invalidateForceFieldFragment(info.fragmentId);

      window.dispatchEvent(
        new CustomEvent<string>("worker-log", {
          detail: `⚡ Energy infused! Machine: ${machineId}\nTx: ${txHash}`,
        }),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      window.dispatchEvent(
        new CustomEvent<string>("worker-log", { detail: `❌ Energize failed: ${msg}` }),
      );
    }
  }
}
