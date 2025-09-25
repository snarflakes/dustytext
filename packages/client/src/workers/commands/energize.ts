// energize.ts
import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { getForceFieldInfoForPlayer, invalidateForceFieldFragment } from "./sense";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

async function findNearbyForceFieldStation(playerAddress: string): Promise<`0x${string}` | null> {
  // Get all machines and check distance to each one
  const query = `SELECT "entityId" FROM "Machine"`;
  
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }]),
  });

  if (!response.ok) return null;

  const result = await response.json();
  const table = result?.result?.[0];
  
  if (!Array.isArray(table) || table.length < 2) return null;

  const [columns, ...rows] = table;
  const entityIdIndex = columns.indexOf("entityId");
  
  if (entityIdIndex === -1) return null;

  // Get player position
  const playerEntityId = encodePlayerEntityId(playerAddress);
  const playerPosQuery = `SELECT "x","y","z" FROM "EntityPosition" WHERE "entityId"='${playerEntityId}'`;
  
  const playerPosResponse = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query: playerPosQuery }]),
  });

  if (!playerPosResponse.ok) return null;

  const playerPosResult = await playerPosResponse.json();
  const playerPosTable = playerPosResult?.result?.[0];
  
  if (!Array.isArray(playerPosTable) || playerPosTable.length < 2) return null;

  const [playerPosCols, playerPosVals] = playerPosTable;
  const playerPos = Object.fromEntries(playerPosCols.map((k: string, i: number) => [k, playerPosVals[i]]));
  
  const playerX = Number(playerPos.x);
  const playerY = Number(playerPos.y);
  const playerZ = Number(playerPos.z);

  // Check each machine
  for (const row of rows) {
    const machineEntityId = row[entityIdIndex] as string;
    
    // Get machine position
    const machinePosQuery = `SELECT "x","y","z" FROM "EntityPosition" WHERE "entityId"='${machineEntityId}'`;
    
    const machinePosResponse = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ address: WORLD_ADDRESS, query: machinePosQuery }]),
    });

    if (!machinePosResponse.ok) continue;

    const machinePosResult = await machinePosResponse.json();
    const machinePosTable = machinePosResult?.result?.[0];
    
    if (!Array.isArray(machinePosTable) || machinePosTable.length < 2) continue;

    const [machinePosCols, machinePosVals] = machinePosTable;
    const machinePos = Object.fromEntries(machinePosCols.map((k: string, i: number) => [k, machinePosVals[i]]));
    
    const machineX = Number(machinePos.x);
    const machineY = Number(machinePos.y);
    const machineZ = Number(machinePos.z);

    // Check if within 5 blocks (Chebyshev distance)
    const distance = Math.max(
      Math.abs(machineX - playerX),
      Math.abs(machineY - playerY),
      Math.abs(machineZ - playerZ)
    );

    if (distance <= 5) {
      return machineEntityId as `0x${string}`;
    }
  }

  return null;
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

      // Need an equipped item (batteries)
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

      // Find a nearby force field station (machine)
      const nearbyStation = await findNearbyForceFieldStation(context.address);
      
      if (!nearbyStation) {
        window.dispatchEvent(
          new CustomEvent<string>("worker-log", {
            detail: "❌ No Force Field Station found within 5 blocks. Build one nearby first.",
          }),
        );
        return;
      }

      // Build calldata to call World -> MachineSystem.energizeMachine(...)
      const callerEntityId = encodePlayerEntityId(context.address);

      const data = encodeFunctionData({
        abi: IWorldAbi,
        functionName: "energizeMachine",
        args: [
          callerEntityId,
          nearbyStation, // use the nearby station's entityId
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

      // Get force field info for cache invalidation
      const info = await getForceFieldInfoForPlayer(context.address);
      invalidateForceFieldFragment(info.fragmentId);

      window.dispatchEvent(
        new CustomEvent<string>("worker-log", {
          detail: `⚡ Energy infused! Station: ${nearbyStation}\nTx: ${txHash}`,
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
