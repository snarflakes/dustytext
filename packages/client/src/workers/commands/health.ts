import { CommandHandler, CommandContext } from './types';
import { bigIntMax } from "@latticexyz/common/utils";
import { encodeFunctionData, parseAbi } from 'viem';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const ENERGY_TABLE = "Energy";
const POSITION_TABLE = "EntityPosition";

const mineAbi = parseAbi([
  'function mineUntilDestroyed(bytes32 caller, uint96 coord, bytes extraData) returns (bytes32)',
]);

function packCoord96(x: number, y: number, z: number): bigint {
  const X = BigInt.asUintN(32, BigInt(x));
  const Y = BigInt.asUintN(32, BigInt(y)); 
  const Z = BigInt.asUintN(32, BigInt(z));
  return (X << 64n) | (Y << 32n) | Z;
}

const SPAWN_ENERGY = 245280000000000000n;

const encodePlayerEntityId = (address: string): `0x${string}` => {
  const prefix = "01";
  const cleanAddress = address.toLowerCase().replace(/^0x/, "");
  const padded = cleanAddress.padEnd(64 - prefix.length, "0");
  return `0x${prefix}${padded}` as `0x${string}`;
};

export class HealthCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      const entityId = encodePlayerEntityId(context.address);
      
      // Get player position for mining test FIRST
      const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
      const posRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
      });

      if (!posRes.ok) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ No position found. Try 'spawn' first.` 
        }));
        return;
      }

      const posJson = await posRes.json();
      const posRows = posJson?.result?.[0];
      if (!Array.isArray(posRows) || posRows.length < 2) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ No position found. Try 'spawn' first.` 
        }));
        return;
      }

      const [posCols, posVals] = posRows;
      const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
      const playerX = Number(pos.x ?? 0);
      const playerY = Number(pos.y ?? 0);
      const playerZ = Number(pos.z ?? 0);

      // Try to mine where your head is (y+1) - should always fail
      const mineY = playerY + 1;
      const packedCoord = packCoord96(playerX, mineY, playerZ);

      try {
        const data = encodeFunctionData({
          abi: mineAbi,
          functionName: 'mineUntilDestroyed',
          args: [entityId, packedCoord, '0x'],
        });

        await context.sessionClient.sendTransaction({
          to: WORLD_ADDRESS,
          data,
          gas: 300000n,
        });

        // This should never happen (mining where your head is)
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `✅ You are alive! (Unexpectedly mined above head at ${playerX}, ${mineY}, ${playerZ})` 
        }));

      } catch (error) {
        const errorMessage = String(error);
        
        // Check for energy error (player is dead)
        if (errorMessage.includes('Entity has no energy') || 
            errorMessage.includes('456e7469747920686173206e6f20656e65726779')) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `💀 You are dead. Your energy has been completely depleted. Type 'spawn' to be reborn.` 
          }));
          return;
        }
        
        // Any other error means we're alive - now get energy info
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `💖 You are alive.` 
        }));
        
        // Now get energy data for display
        try {
          const query = `SELECT energy, drainRate, lastUpdatedTime FROM "${ENERGY_TABLE}" WHERE entityId = '${entityId}'`;
          
          const response = await fetch(INDEXER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
          });

          if (response.ok) {
            const result = await response.json();
            const table = result?.result?.[0];
            
            if (Array.isArray(table) && table.length >= 2) {
              const columns = table[0];
              const values = table[1];
              const row = Object.fromEntries(columns.map((key: string, i: number) => [key, values[i]]));

              const energy = BigInt(row.energy ?? 0);
              const drainRate = BigInt(row.drainRate ?? 0);
              const lastUpdatedTime = BigInt(row.lastUpdatedTime ?? 0);

              // Calculate optimistic energy
              const currentTime = BigInt(Date.now());
              const lastUpdatedTimeMs = lastUpdatedTime * 1000n;
              const elapsed = (currentTime - lastUpdatedTimeMs) / 1000n;
              const energyDrained = elapsed * drainRate;
              const optimisticEnergy = bigIntMax(0n, energy - energyDrained);

              const percentage = Number((optimisticEnergy * 100n) / SPAWN_ENERGY);
              window.dispatchEvent(new CustomEvent("worker-log", { 
                detail: `Energy: ${optimisticEnergy.toString()} (${percentage.toFixed(1)}%)` 
              }));
            }
          }
        } catch (energyError) {
          // Energy fetch failed, but we know they're alive from mining test
        }
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Health check failed: ${error}` 
      }));
    }
  }
}


























